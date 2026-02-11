"""
Basic demo: create a 2-universe, single-frame DAT file.

Universe 0 – white pixels with red markers on first & last pixel.
Universe 1 – all white pixels.

Outputs:
    demo_output.dat   – binary file for the H803TC SD card
    demo_output.txt   – human-readable summary
"""

from ledat import DATFile


def main():
    dat = DATFile()
    dat.add_universe(400)  # universe 0
    dat.add_universe(400)  # universe 1
    dat.set_num_frames(1)

    # Universe 0: white background, red first & last pixel
    for p in range(400):
        dat.set_pixel(0, 0, p, 255, 255, 255)
    dat.set_pixel(0, 0, 0, 255, 0, 0)
    dat.set_pixel(0, 0, 399, 255, 0, 0)

    # Universe 1: all white
    for p in range(400):
        dat.set_pixel(1, 0, p, 255, 255, 255)

    bytes_written = dat.write("demo_output.dat")
    print(f"Written: {dat}")
    print(f"DAT size: {bytes_written} bytes")

    # Print the txt summary
    with open("demo_output.txt") as f:
        print(f"\n{f.read()}")


if __name__ == "__main__":
    main()
