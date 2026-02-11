# Le-Dat-Converter

Python and JavaScript library for generating `.dat` files compatible with [LEDBuild](https://www.cqiled.com/down/dmxsoft/ledbuild_down_en.html) and the [Huacan H803TC](http://www.huacanled.com/html/46-cn.shtml) LED controller family.

## What is this?

The H803TC is an offline/online master LED controller that reads `.dat` files from an SD card to drive pixel LED installations. LEDBuild is the Windows-only software normally used to create these files.

This library lets you **generate `.dat` files programmatically** — no Windows or LEDBuild required. Available in both Python (for scripting/CLI) and JavaScript (for browser apps).

### Supported hardware

| Controller | Role | Max pixels |
|---|---|---|
| H803TC | Master controller | 170,000 |
| H801RC | Slave controller | 8,192 (8 ports) |
| H801RA | Slave controller | 3,412 (4 ports) |
| H802RA | Slave controller | 4,096 (4 ports) |

## Python

### Installation

```bash
pip install -e .
```

Requires Python 3.10+ and NumPy.

### Quick start

```python
from ledat import DATFile

dat = DATFile()
dat.add_universe(400)   # universe 0: 400 LEDs
dat.add_universe(200)   # universe 1: 200 LEDs
dat.set_num_frames(60)

dat.set_pixel(0, 0, 0, 255, 0, 0)   # universe 0, frame 0, pixel 0 = red
dat.set_pixel(1, 0, 0, 0, 255, 0)   # universe 1, frame 0, pixel 0 = green

r, g, b = dat.get_pixel(0, 0, 0)    # (255, 0, 0)

dat.write("output.dat")  # also writes output.txt
```

### Python API

| Method | Description |
|---|---|
| `DATFile(template_file=None)` | Create an empty builder. Optional LEDBuild `.dat` file for header reuse. |
| `dat.add_universe(num_leds) -> int` | Add a universe. Returns 0-based index. |
| `dat.set_num_frames(n)` | Set global frame count. New pixels default to black. |
| `dat.set_pixel(universe, frame, pixel, r, g, b)` | Set a pixel's RGB colour (0-255). |
| `dat.get_pixel(universe, frame, pixel) -> (r,g,b)` | Read a pixel's RGB colour. |
| `dat.write(filename) -> int` | Write `.dat` + `.txt` summary. Returns bytes written. |
| `dat.clear()` | Clear frame data, keep universe config. |

Properties: `dat.num_universes`, `dat.num_frames`, `dat.total_pixels`, `dat.universe_leds(i)`

## JavaScript (Browser)

### Quick start

```html
<script type="module">
  import { DATFile } from "./js/datfile.js";

  const dat = new DATFile();
  dat.addUniverse(400);
  dat.addUniverse(200);
  dat.setNumFrames(60);

  dat.setPixel(0, 0, 0, 255, 0, 0);  // universe 0, frame 0, pixel 0 = red

  const [r, g, b] = dat.getPixel(0, 0, 0);  // [255, 0, 0]

  dat.download("output.dat");     // triggers .dat download
  dat.downloadTxt("output.txt");  // triggers .txt download
</script>
```

### JavaScript API

| Method | Description |
|---|---|
| `new DATFile()` | Create an empty builder. |
| `dat.addUniverse(numLeds): number` | Add a universe. Returns 0-based index. |
| `dat.setNumFrames(n)` | Set global frame count. New pixels default to black. |
| `dat.setPixel(universe, frame, pixel, r, g, b)` | Set a pixel's RGB colour (0-255). |
| `dat.getPixel(universe, frame, pixel): [r,g,b]` | Read a pixel's RGB colour. |
| `dat.toUint8Array(): Uint8Array` | Build the `.dat` file as raw bytes. |
| `dat.toBlob(): Blob` | Build the `.dat` file as a Blob. |
| `dat.toTxt(): string` | Generate the `.txt` summary string. |
| `dat.download(filename?)` | Trigger a browser download of the `.dat` file. |
| `dat.downloadTxt(filename?)` | Trigger a browser download of the `.txt` summary. |
| `dat.loadTemplateHeader(arrayBuffer)` | Load a 512-byte header from an existing `.dat` file. |
| `dat.clear()` | Clear frame data, keep universe config. |

Properties: `dat.numUniverses`, `dat.numFrames`, `dat.totalPixels`, `dat.universeLeds(i)`

## DAT file format

| Section | Size | Description |
|---|---|---|
| Header | 512 bytes | Magic bytes `00 00 48 43` ("HC") + controller config |
| Frame N | `total_pixels * 3` bytes + padding | All universes concatenated, BGR byte order, padded to 512-byte boundary |

Each frame is individually padded to the next 512-byte boundary.

## Project structure

```
Le-Dat-Converter/
  ledat/
    __init__.py
    datfile.py          # Python DATFile class
  js/
    datfile.js          # JavaScript DATFile class (ES module)
  examples/
    demo.py             # Python usage example
  pyproject.toml
  README.md
```

## Examples

Python demo:

```bash
pip install -e .
python examples/demo.py
```

## License

MIT
