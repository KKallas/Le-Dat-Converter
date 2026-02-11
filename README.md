# Le-Dat-Converter

Python library for generating `.dat` files compatible with [LEDBuild](https://www.cqiled.com/down/dmxsoft/ledbuild_down_en.html) and the [Huacan H803TC](http://www.huacanled.com/html/46-cn.shtml) LED controller family.

## What is this?

The H803TC is an offline/online master LED controller that reads `.dat` files from an SD card to drive pixel LED installations. LEDBuild is the Windows-only software normally used to create these files.

This library lets you **generate `.dat` files programmatically** in Python — no Windows or LEDBuild required.

### Supported hardware

| Controller | Role | Max pixels |
|---|---|---|
| H803TC | Master controller | 170,000 |
| H801RC | Slave controller | 8,192 (8 ports) |
| H801RA | Slave controller | 3,412 (4 ports) |
| H802RA | Slave controller | 4,096 (4 ports) |

## Installation

```bash
pip install -e .
```

Requires Python 3.10+ and NumPy.

## Quick start

```python
from ledat import DATFile

# Create an empty file
dat = DATFile()

# Add universes (each can have a different LED count)
dat.add_universe(400)   # universe 0: 400 LEDs
dat.add_universe(200)   # universe 1: 200 LEDs

# Set the number of frames (shared across all universes)
dat.set_num_frames(60)

# Set pixels individually: (universe, frame, pixel, r, g, b)
dat.set_pixel(0, 0, 0, 255, 0, 0)      # universe 0, frame 0, pixel 0 = red
dat.set_pixel(1, 0, 0, 0, 255, 0)      # universe 1, frame 0, pixel 0 = green

# Read a pixel back
r, g, b = dat.get_pixel(0, 0, 0)       # (255, 0, 0)

# Write output (produces both output.dat and output.txt)
dat.write("output.dat")
```

The `.txt` file is generated automatically alongside the `.dat` and documents the configuration:

```
Universes: 2
Universe 0: 400 LEDs
Universe 1: 200 LEDs
Frames: 60
```

## API

### `DATFile(template_file=None)`

Create an empty DAT file builder. Optionally pass a path to a LEDBuild-generated `.dat` file to reuse its 512-byte header.

### `dat.add_universe(num_leds) -> int`

Add a universe with the given number of LEDs. Returns the 0-based universe index.

### `dat.set_num_frames(n)`

Set the global frame count for all universes. New pixels are initialised to black. Existing data is preserved when resizing.

### `dat.set_pixel(universe, frame, pixel, r, g, b)`

Set a single pixel's RGB colour (values 0-255).

### `dat.get_pixel(universe, frame, pixel) -> (r, g, b)`

Read back a pixel's RGB colour.

### `dat.write(filename, template_file=None) -> int`

Write the `.dat` binary file and a `.txt` summary. Returns bytes written.

### `dat.clear()`

Clear all frame data while keeping the universe configuration.

### Properties

- `dat.num_universes` - number of universes
- `dat.num_frames` - global frame count
- `dat.total_pixels` - total pixels across all universes
- `dat.universe_leds(i)` - LED count for universe *i*

## DAT file format

| Section | Size | Description |
|---|---|---|
| Header | 512 bytes | Magic bytes `00 00 48 43` ("HC") + controller config |
| Frame N | `total_pixels * 3` bytes | All universes concatenated, BGR byte order |
| Padding | 0-511 bytes | Zero-padded to 512-byte boundary |

## Project structure

```
Le-Dat-Converter/
  ledat/
    __init__.py
    datfile.py        # DATFile class
  examples/
    demo.py           # basic usage example
  pyproject.toml
  README.md
```

## Examples

Run the demo:

```bash
python examples/demo.py
```

## License

MIT
