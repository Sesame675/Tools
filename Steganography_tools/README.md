self-learning purpose

# img_steg.py
A simple command-line tool that hides and extracts **text messages** inside **PNG images** using **Least Significant Bit (LSB) steganography** approach. It hides information leveraging all 3 channels of RGB. The tool works with both **RGB** and **RGBA** PNG images and preserves image appearance and transparency.

usage: img_steg.py [-h] -i INPUT {encode,decode}  
options:  
-h, --help show this help message and exit  
-i, --input INPUT Input File - PNG image  
-o, --output OUTPUT Output File path  
-t, --text TEXT Text message to hide  
-f, --file FILE File containing text message to hide  
  
## Requirements
- Python **3.8+**
- Pillow (PIL) >= 10.0.0
