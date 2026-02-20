# Le-Dat-Converter

Python and JavaScript library for generating `.dat` files compatible with [LEDBuild](https://www.cqiled.com/down/dmxsoft/ledbuild_down_en.html) and the [Huacan H803TC](http://www.huacanled.com/html/46-cn.shtml) LED controller family.

## What is this?

The H803TC is an offline/online master LED controller that reads `.dat` files from an SD card to drive pixel LED installations. LEDBuild is the Windows-only software normally used to create these files.

This project provides:

1. **A browser-based video/image-to-DAT converter** — upload a video or image, define LED strip paths with polylines, render previews, download a `.dat` file. No install needed, works on phone.
2. **Python and JavaScript libraries** for generating `.dat` files programmatically.

### Supported hardware

| Controller | Role | Max pixels |
|---|---|---|
| H803TC | Master controller | 170,000 |
| H801RC | Slave controller | 8,192 (8 ports) |
| H801RA | Slave controller | 3,412 (4 ports) |
| H802RA | Slave controller | 4,096 (4 ports) |

---

## Web App — Video/Image to DAT

The quickest way to create a `.dat` file. Runs entirely in the browser with zero dependencies — pure ES modules, no build system.

### How to run

```bash
python start_server.py
```

This starts a local web server and opens the app in your browser at `http://localhost:8080/web/index.html`. You can also pass a custom port: `python start_server.py 3000`.

### How to use

1. **Load media** — Click "Choose File" and select a video or image from your device.

2. **Set up controllers & ports** — Click **+ Add Controller** to add a controller. Each controller has ports (up to 8). Each port represents one LED strip with a configurable LED count.

3. **Define LED strip paths** — Each port has a polyline (A, B, C... points) that defines where pixels are sampled from the media. In the rack sidebar:
   - Adjust point coordinates directly in the number inputs
   - Click **+ Point** to add more points to the polyline
   - Set the **LEDs** count and **Trim start/end** values per port

4. **Multi-select & transform** — Select points across multiple ports for batch operations:
   - **Click** a point to select it, **Shift+click** to add to selection
   - **Select All** button on port or controller headers
   - **Double-click** on the viewport to select the closest point
   - Use the **Transform** toolbar below the viewport to offset, rotate, and scale selected points together

5. **Viewport tools** — Triple-click the viewport to toggle the viewer toolbar:
   - **Points** mode (default) — click/drag to move points, double-click to select nearest
   - **Pan** mode — left-click drag to pan the view
   - **Zoom** mode — drag up/down to zoom in/out
   - **Home** — reset view to default
   - **Selected** — zoom to fit selected points
   - **Full** — toggle fullscreen viewport (ESC to exit)
   - Middle-click pan and scroll-wheel zoom work in all modes

6. **Render previews** — Click **Render** on a port to generate its LED preview (one row per frame, one column per LED).

7. **Set in/out points** — For video, use the playback controls to set the frame range for export.

8. **Loop blend** — Set the loop blend count to crossfade the last N frames with the first N frames for seamless looping. The blended result is used for playback and mapping.

9. **Export** — Click **Export .dat** to download the binary file for your controller's SD card. Supports multi-controller setups (more than 8 ports).

10. **Save/Load** — Save and restore entire scenes (media + all port configurations) as `.zip` files.

### Architecture

The web app is organized into modular ES modules:

- **Rack sidebar** (left panel) — controller/port hierarchy, per-port point editing (Points tool), coordinate save/load (Save/Load tool), LED count, trim, render previews
- **Viewport** (right panel) — media display with overlay canvas, pan/zoom/fullscreen, polyline visualization with zoom-independent UI elements, viewer toolbar for mode switching
- **Scene toolbar** (below viewport) — pluggable scene tools operating on multi-selected points across ports/controllers (e.g. Transform: offset, pivot, rotate, scale)

### Hosting on ESP32

The web app is pure static files with zero external dependencies. To serve it from an ESP32:

1. Copy these files/folders to the ESP32 filesystem (SPIFFS/LittleFS):
   - `web/index.html`
   - `web/app.js`
   - `web/style.css`
   - `web/core/` — `utils.js`
   - `web/player/` — `player.js`, `viewport.js`, `viewer-toolbar.js`
   - `web/rack/` — `rack.js`, `port-model.js`
   - `web/renderer/` — `sampling.js`
   - `web/tools/` — `toolbar.js`, `controller/registry.js`, `controller/points/tool.js`, `controller/saveload/tool.js`, `scene/registry.js`, `scene/transform/tool.js`
   - `web/scene/` — `save.js`, `load.js`
   - `web/output/` — `export.js`
   - `js/datfile.js`
2. Serve them with any ESP32 HTTP server library, keeping the same directory structure.

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

dat.set_pixel(0, 0, 0, 255, 0, 0)   # universe 0, frame 0, pixel 0 = red (linear RGB)
dat.set_pixel(1, 0, 0, 0, 255, 0)   # universe 1, frame 0, pixel 0 = green

r, g, b = dat.get_pixel(0, 0, 0)    # (255, 0, 0)

dat.write("output.dat")  # also writes output.txt (gamma 2.2 applied automatically)
```

Multi-controller setups are handled automatically — adding more than 8 universes creates additional controllers.

### Python API

| Method | Description |
|---|---|
| `DATFile(template_file=None)` | Create an empty builder. Optional LEDBuild `.dat` file for header reuse. |
| `dat.add_universe(num_leds) -> int` | Add a universe. Returns 0-based index. |
| `dat.set_num_frames(n)` | Set global frame count. New pixels default to black. |
| `dat.set_pixel(universe, frame, pixel, r, g, b)` | Set a pixel's RGB colour (0-255). |
| `dat.get_pixel(universe, frame, pixel) -> (r,g,b)` | Read a pixel's RGB colour. |
| `dat.append(frames, universe)` | Append NumPy frame data `(frames, pixels, 3)` to a universe. |
| `dat.write(filename) -> int` | Write `.dat` + `.txt` summary. Returns bytes written. |
| `dat.clear()` | Clear frame data, keep universe config. |
| `DATFile.load_header_from_file(dat_file, ...)` | Class method: load and register a template header from an existing `.dat` file. |

Properties: `dat.num_universes`, `dat.num_frames`, `dat.total_pixels`, `dat.max_leds_per_port`, `dat.controller_count`, `dat.group_size`, `dat.universe_leds(i)`

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

Properties: `dat.numUniverses`, `dat.numFrames`, `dat.totalPixels`, `dat.maxLedsPerPort`, `dat.controllerCount`, `dat.groupSize`, `dat.universeLeds(i)`

---

## DAT file format

| Section | Size | Description |
|---|---|---|
| Header | 512 bytes | Magic bytes `00 00 48 43` ("HC") + controller config, slave count at offset 0x10 |
| Frame N | `max_leds × 3 × group_size` + padding | Interleaved 8×N-byte groups, BGR channel order, gamma 2.2 corrected, padded to 512-byte boundary |

Key format details:
- **Group size** = 8 bytes per controller (`8 × controller_count`)
- **Channel order**: 3 groups per LED — B, G, R (not RGB)
- **Port mapping**: within each controller's 8-byte block, port N maps to byte position `8 - N` (reverse order)
- **Multi-controller**: universes 0–7 go to controller 1, 8–15 to controller 2, etc.
- **Gamma correction**: all values are gamma 2.2 encoded — `round(pow(brightness / 255, 2.2) * 255)`

See [DAT-FORMAT.md](DAT-FORMAT.md) for the full binary format specification with verified examples.

## Project structure

```
Le-Dat-Converter/
  web/
    index.html              # entry point
    app.js                  # bootstrap: imports modules, wires state & actions
    style.css               # all styling
    core/
      utils.js              # zip, crc32, download helpers
    player/
      player.js             # playback: play/pause/stop/seek, frame extraction
      viewport.js           # overlay canvas, pan/zoom, coordinate transforms
      viewer-toolbar.js     # viewport mode selector (pan/zoom/points), fullscreen
    rack/
      rack.js               # controller/port sidebar UI
      port-model.js         # port/controller CRUD + data structures
    renderer/
      sampling.js           # samplePolyline, samplePortLine math
    tools/
      toolbar.js            # generic scene tool host (below viewport)
      controller/           # per-port tools (rack sidebar dropdown)
        registry.js         # imports & exports all controller tools
        points/
          tool.js           # point editing panel
          howto.md
        saveload/
          tool.js           # copy/paste normalized coordinates
          howto.md
      scene/                # global tools (toolbar below viewport)
        registry.js         # imports & exports all scene tools
        transform/
          tool.js           # offset/pivot/rotate/scale selected points
          howto.md
    scene/
      save.js               # serialize scene + zip
      load.js               # parse zip + deserialize scene
    output/
      export.js             # build DATFile from rendered previews
  js/
    datfile.js              # JavaScript DATFile class (ES module)
  ledat/
    __init__.py
    datfile.py              # Python DATFile class
  examples/
    demo.py                 # Python usage example
  start_server.py           # local dev server
  pyproject.toml
  README.md
  DAT-FORMAT.md             # full .dat binary format specification
```

## License

MIT
