document.addEventListener('DOMContentLoaded', async () => {
  const siteList = document.getElementById('siteList');
  const selectAllCheckbox = document.getElementById('selectAll');
  const clearCookiesCheckbox = document.getElementById('clearCookiesCheckbox');
  const clearButton = document.getElementById('clearButton');
  const messageBox = document.getElementById('messageBox');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const searchInput = document.getElementById('searchInput');
  const sortSelect = document.getElementById('sortSelect');

  let allSites = [];
  let visitedSiteSet = new Set();

  const showMessage = (message, isError = false) => {
    messageBox.textContent = message;
    messageBox.style.display = 'block';
    messageBox.style.backgroundColor = isError ? '#fecaca' : '#d1fae5';
    messageBox.style.color = isError ? '#b91c1c' : '#065f46';
  };

  // ---------- eTLD+1 extraction ----------
  const MULTIPART_TLDS = new Set([
    'co.uk','org.uk','gov.uk','ac.uk',
    'com.au','com.br','com.cn','com.hk','com.sg','com.tr','com.tw','com.mx',
    'co.jp','co.in'
  ]);
  function getETLDplus1FromHostname(hostname) {
    try {
      const parts = hostname.toLowerCase().split('.').filter(Boolean);
      if (parts.length <= 2) return parts.join('.') || hostname;
      const last2 = parts.slice(-2).join('.');
      const last3 = parts.slice(-3).join('.');
      if (MULTIPART_TLDS.has(last2)) return last3;
      return last2;
    } catch {
      return hostname;
    }
  }

  // ---------- Auth-like keyword detection ----------
  const AUTH_KEYWORDS = ['sso', 'idp', 'oidc'];
  function looksAuthLikeDomain(domain) {
    const d = (domain || '').toLowerCase();
    return AUTH_KEYWORDS.some(
      k => new RegExp(`(^|[.\\-])${k}([.\\-]|$)`).test(d)
    );
  }


  const getDomainFromUrl = (url) => {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return hostname.startsWith('www.') ? hostname.substring(4) : hostname;
    } catch {
      return null;
    }
  };

  // ---------- History (90 days) ----------
  const fetchVisitCountsAndVisitedSet = async () => {
    const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
    const since = Date.now() - THREE_MONTHS_MS;

    const historyItems = await chrome.history.search({
      text: '',
      startTime: since,
      maxResults: 10000
    });

    const domainVisitCounts = new Map();
    const visitedSet = new Set();

    for (const item of historyItems) {
      const domain = getDomainFromUrl(item.url);
      if (!domain) continue;
      domainVisitCounts.set(domain, (domainVisitCounts.get(domain) || 0) + (item.visitCount || 0));
      const site = getETLDplus1FromHostname(domain);
      if (site) visitedSet.add(site);
    }

    return { domainVisitCounts, visitedSet };
  };

  const populateSiteList = async () => {
    loadingIndicator.style.display = 'block';
    clearButton.disabled = true;
    siteList.innerHTML = '';
    messageBox.style.display = 'none';

    try {
      // 1) Cookies → count only
      const cookies = await chrome.cookies.getAll({});
      const domainCookieCounts = new Map();
      cookies.forEach(cookie => {
        const raw = cookie.domain || '';
        const domain = raw.startsWith('.') ? raw.substring(1) : raw;
        if (!domain) return;
        domainCookieCounts.set(domain, (domainCookieCounts.get(domain) || 0) + 1);
      });

      // 2) History → visit counts + visited eTLD+1 set
      const { domainVisitCounts, visitedSet } = await fetchVisitCountsAndVisitedSet();
      visitedSiteSet = visitedSet;

      // 3) Merge
      const mergedSites = new Map();
      domainCookieCounts.forEach((count, domain) => {
        mergedSites.set(domain, {
          domain,
          cookieCount: count,
          visitCount: domainVisitCounts.get(domain) || 0
        });
      });
      domainVisitCounts.forEach((count, domain) => {
        if (!mergedSites.has(domain)) {
          mergedSites.set(domain, {
            domain,
            cookieCount: 0,
            visitCount: count
          });
        }
      });

      allSites = Array.from(mergedSites.values());
      if (allSites.length === 0) showMessage('No sites with stored data found.', false);
      else sortAndRenderList();
    } catch (error) {
      showMessage(`Error: ${error.message}`, true);
      console.error('Error fetching data:', error);
    } finally {
      loadingIndicator.style.display = 'none';
      clearButton.disabled = false;
    }
  };

  // ---------- Sorting / Filtering ----------
  const sortAndRenderList = () => {
    const sortBy = sortSelect.value;
    const searchTerm = searchInput.value.toLowerCase();

    let filteredSites = allSites.filter(site => site.domain.toLowerCase().includes(searchTerm));

    if (sortBy === 'zeroVisits') {
      filteredSites = filteredSites.filter(site => {
        if (site.visitCount !== 0) return false;
        const etld1 = getETLDplus1FromHostname(site.domain);
        // Exclude if eTLD+1 has been visited in the past 90 days
        if (etld1 && visitedSiteSet.has(etld1)) return false;
        // Exclude if domain looks like SSO/IDP/OIDC
        if (looksAuthLikeDomain(site.domain)) return false;
        return true;
      });

      filteredSites.sort((a, b) => b.cookieCount - a.cookieCount);
      if (filteredSites.length === 0)
        showMessage('No sites with zero visits found in the filtered list.', false);
    } else if (sortBy === 'visitCount') {
      filteredSites.sort((a, b) => b.visitCount - a.visitCount);
    } else if (sortBy === 'cookieCount') {
      filteredSites.sort((a, b) => b.cookieCount - a.cookieCount);
    }

    renderSiteList(filteredSites);
  };

  const renderSiteList = (sites) => {
    siteList.innerHTML = '';
    if (sites.length === 0 && sortSelect.value !== 'zeroVisits') {
      showMessage('No matching sites found.', false);
      return;
    }

    sites.forEach(site => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="site-info">
          <input type="checkbox" data-domain="${site.domain}" checked>
          <span class="site-name">${site.domain}</span>
          <span class="site-count">${site.visitCount} visits / ${site.cookieCount} cookies</span>
        </div>
      `;
      siteList.appendChild(li);
    });
  };

  // ---------- UI listeners ----------
  selectAllCheckbox.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    document.querySelectorAll('#siteList input[type="checkbox"]').forEach(cb => (cb.checked = isChecked));
  });
  searchInput.addEventListener('input', sortAndRenderList);
  sortSelect.addEventListener('change', sortAndRenderList);

  clearButton.addEventListener('click', async () => {
    const checked = [...document.querySelectorAll('#siteList input[type="checkbox"]:checked')];
    const domainsToClear = checked.map(cb => cb.dataset.domain);
    if (domainsToClear.length === 0) {
      showMessage('Please select at least one site to clear.', true);
      return;
    }

    clearButton.textContent = 'Clearing...';
    clearButton.disabled = true;
    showMessage('Clearing data...', false);

    const dataToRemove = {
      indexedDB: true,
      localStorage: true,
      cacheStorage: true,
      cookies: clearCookiesCheckbox.checked
    };

    try {
      for (const domain of domainsToClear) {
        await chrome.browsingData.remove({ origins: [`https://${domain}`, `http://${domain}`] }, dataToRemove);
      }
      showMessage(`Successfully cleared data for ${domainsToClear.length} site(s).`);
      setTimeout(() => populateSiteList(), 200);
    } catch (err) {
      showMessage(`Error clearing data: ${err.message}`, true);
      console.error('Error clearing data:', err);
    } finally {
      clearButton.textContent = 'Clear Selected Data';
      clearButton.disabled = false;
    }
  });

  populateSiteList();
});
