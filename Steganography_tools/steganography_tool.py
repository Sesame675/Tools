from PIL import Image
import argparse
import os
from typing import Tuple


def validate_args(parser: argparse.ArgumentParser, args: argparse.Namespace):
    # check if input file exist and is a PNG image
    if not os.path.isfile(args.input):
        parser.error(f"ERROR - Input file does not exist: {args.input}")

    try:
        input_img = Image.open(args.input) # check the header
        input_img.load()  # fully load and validate all pixels of the image
    except Exception:
        parser.error("ERROR - Input file is not a valid image")

    if input_img.format != "PNG":
        parser.error("ERROR - Input file must be a PNG file")

    # check the pixel format
    image_mode = input_img.mode
    if image_mode not in ("RGB", "RGBA"):
        parser.error("ERROR - Input file must be RGB or RGBA")

    if args.cmd == "encode":
        # Check if the output directory exists
        output_path = os.path.dirname(args.output)
        if output_path and not os.path.isdir(output_path):
            parser.error(f"ERROR - Output path does not exist: {output_path}")

        msg_file = getattr(args, "file", None)
        if msg_file and not os.path.isfile(msg_file):
            parser.error(f"ERROR - Message file does not exist: {msg_file}")

    return input_img, image_mode


def bytes_to_bits(data: bytes):
    """
    In a byte:
    bit 0 = rightmost bit, LSB
    bit 7 = lesftmost bit, MSB
    bit numbers count from right to left - LSB to MSB
    """
    bits = []
    for byte in data:
        for i in range(7, -1, -1):
            bits.append((byte >> i) & 1) # right shift i, then read the last bit
    return bits


def bits_to_bytes(data: list[int]):
    out = bytearray()
    for i in range(0, len(data), 8):
        b = 0
        for bit in data[i:i+8]:
            b = (b << 1) | bit
        out.append(b)
    return bytes(out)


def add_header(message:str):
    msg_byte = message.encode("utf-8")
    header = len(msg_byte).to_bytes(4, "big") # 32-bit, marking the length of the message
    return header+msg_byte


def main() -> None:
    # ========= Parsing Commandline Arguments =============
    parser = argparse.ArgumentParser(description="Image Steganography Tool")

    parser.add_argument(
        "-i", "--input",
        required=True,
        help="Input File - PNG image"
        )
    
    # sub-commands - for encode and decode mode
    sub = parser.add_subparsers(dest="cmd", required=True)

    # Encode Mode
    encode = sub.add_parser("encode", help="Encode/Hide text in image")
    encode.add_argument(
        "-o", "--output",
        default="output.png",
        help="Output File path"
        )
    """
    Ceate a group of command-line options where the user must choose 
    exactly one option from the group.
    In this case, either -t or -f
    """
    group = encode.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "-t", "--text",
        help="Text message to hide"
    )

    group.add_argument(
        "-f", "--file",
        help="File containing text message to hide"
    )

    # Decode Mode
    decode = sub.add_parser("decode", help="Decode/Extract text from image")

    args = parser.parse_args()
    input_img, image_mode = validate_args(parser, args)

    # Encode message in image======================================
    if args.cmd == "encode":
        if args.text:
            message = args.text
        else:
            with open(args.file, 'r', encoding="utf-8") as f:
                message = f.read()

        width, height = input_img.size
        capacity = width * height * 3   # storing in R,G,B channels, so 3 bits per pixel for capacity
        
        headed_msg = add_header(message)
        msg_bits = bytes_to_bits(headed_msg)
        if len(msg_bits) > capacity:
            raise ValueError(f"Message too large for the chosen image: need {len(msg_bits)} bits, capacity is {capacity} bits.")

        copy_img = input_img.copy()
        pixel_img = copy_img.load()

        # message hidding counter
        bit_idx = 0
        # row by row, left to right
        for y in range(height):
            for x in range(width):
                if bit_idx >= len(msg_bits):
                    copy_img.save(args.output, "PNG")
                    return

                # fetch the current pixel's color - RGB or RGBA
                # Pillow use tuples for pixels, so first conver to list, then back to tuple when placed back
                pixel = list(pixel_img[x, y])
                for c in range(3):    # only change R,G,B, no touch of A
                    if bit_idx >= len(msg_bits):
                        break
                    # 0xFE = 11111110, keep all bits the same excep the last one
                    pixel[c] = (pixel[c] & 0xFE) | msg_bits[bit_idx]
                    bit_idx += 1
                pixel_img[x,y] = tuple(pixel)
        copy_img.save(args.output, "PNG")

    # Decode hidden text in the image==========================================================
    elif args.cmd == "decode":
        width, height = input_img.size
        pixel = input_img.load()
        
        # yield LSBs from RGB channels only (ignores alpha)
        def lsb_stream():
            for y in range(height):
                for x in range(width):
                    p = pixel[x, y]
                    yield p[0] & 1
                    yield p[1] & 1
                    yield p[2] & 1

        stream = lsb_stream()

        try:
            # Read 32 bits header => message length in bytes
            header_bits = [next(stream) for _ in range(32)]
            msg_len = int.from_bytes(bits_to_bytes(header_bits), "big")

            # ensure header is meaningful
            max_bytes = (width * height * 3 - 32) // 8
            if msg_len < 0 or msg_len > max_bytes:
                raise ValueError("No valid hidden message found (length header invalid).")

            # Read message bits
            msg_bits = [next(stream) for _ in range(msg_len * 8)]
        except StopIteration:
            raise ValueError("Image ended early (no hidden message or corrupted data).")

        msg_bytes = bits_to_bytes(msg_bits)

        decoded_msg = msg_bytes.decode("utf-8", errors="strict")

        print(f"Here is the decoded hidden message from the image: \n {decoded_msg}")


if __name__ == "__main__":
    main()


