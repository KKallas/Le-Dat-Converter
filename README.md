# Le-Dat-Converter

Python and JavaScript library for generating `.dat` files compatible with [LEDBuild](https://www.cqiled.com/down/dmxsoft/ledbuild_down_en.html) and the [Huacan H803TC](http://www.huacanled.com/html/46-cn.shtml) LED controller family.

## What is this?

The H803TC is an offline/online master LED controller that reads `.dat` files from an SD card to drive pixel LED installations. LEDBuild is the Windows-only software normally used to create these files.

This project provides:

1. **A browser-based video-to-DAT converter** — upload a video, pick a sample line, download a `.dat` file. No install needed, works on phone.
2. **Python and JavaScript libraries** for generating `.dat` files programmatically.

### Supported hardware

| Controller | Role | Max pixels |
|---|---|---|
| H803TC | Master controller | 170,000 |
| H801RC | Slave controller | 8,192 (8 ports) |
| H801RA | Slave controller | 3,412 (4 ports) |
| H802RA | Slave controller | 4,096 (4 ports) |

---

## Web App — Video to DAT

The quickest way to create a `.dat` file. Runs entirely in the browser with zero dependencies.

### How to run

```bash
python start_server.py
```

This starts a local web server and opens the app in your browser at `http://localhost:8080/web/index.html`. You can also pass a custom port: `python start_server.py 3000`.

### How to use

1. **Load a video** — Click "Choose File" and select a video from your device.

2. **Position the sample line** — The video appears with default A/B points. Adjust the **Point A** (x, y) and **Point B** (x, y) inputs to place a line across the area of the video you want to map to your LED strip. A coloured overlay shows the line on the video.

3. **Set LED count** — Enter the number of LEDs in your strip in the **LEDs** field (default: 400). This controls how many pixels are sampled along the line.

4. **Process** — Click **Process Video**. The frame rate is auto-detected from the video. Every frame is extracted and sampled along the A→B line. A preview image builds up below (one row per frame, one column per LED). Playback speed is controlled on the H803TC itself.

5. **Download** — Once processing is complete:
   - Click **Download .dat** to get the binary file for your H803TC SD card.
   - Click **Download .txt** to get a human-readable summary of universes and frame count.

6. **Copy to SD card** — Put the `.dat` file on a FAT32-formatted SD card and insert it into your H803TC controller.

### Hosting on ESP32

The web app is pure static files with zero external dependencies. To serve it from an ESP32:

1. Copy these files to the ESP32 filesystem (SPIFFS/LittleFS):
   - `web/index.html`
   - `web/app.js`
   - `web/style.css`
   - `js/datfile.js`
2. Serve them with any ESP32 HTTP server library, keeping the same directory structure.

Total size is ~5KB.

---

## Python Library

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

---

## JavaScript Library (Browser)

### Quick start

```html
<script type="module">
  import { DATFile } from "./js/datfile.js";

  const dat = new DATFile();
  dat.addUniverse(400);
  dat.setNumFrames(60);

  dat.setPixel(0, 0, 0, 255, 0, 0);
  dat.download("output.dat");
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

---

## DAT file format

| Section | Size | Description |
|---|---|---|
| Header | 512 bytes | Magic bytes `00 00 48 43` ("HC") + controller config |
| Frame N | `total_pixels * 3` bytes + padding | All universes concatenated, BGR byte order, padded to 512-byte boundary |

Each frame is individually padded to the next 512-byte boundary.

## Project structure

```
Le-Dat-Converter/
  web/
    index.html          # browser app — video to DAT converter
    app.js              # app logic
    style.css           # styling
  js/
    datfile.js          # JavaScript DATFile class (ES module)
  ledat/
    __init__.py
    datfile.py          # Python DATFile class
  examples/
    demo.py             # Python usage example
  milestones/
    v0.1.md             # roadmap
  start_server.py       # local dev server
  pyproject.toml
  README.md
```

## License

MIT
