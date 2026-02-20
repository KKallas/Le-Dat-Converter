# SmartLED QED3110 Decoration System — Project Plan

End-to-end system for smart LED (QED3110) decorations: mapping, animation playback, scheduling, live control, and hardware management.

---

## System Overview

```
              LOCAL ACCESS                           REMOTE ACCESS
              (QR: WiFi)                             (QR: URL)

         Customer phone                          Customer phone
              │                                       │
              │ connects to WiFi                      │ opens URL
              │ "DECO-TREE-01"                        │ https://tree-01.example.com
              │                                       │
         ESP32 Atom (AP)                         Cloudflare Tunnel
              │ WiFi AP + DNS                         │ (or frp / ngrok)
              │ all DNS → phone IP                    │
              │                                       │
    +---------+---------+                    +--------+--------+
    |                   |                    |                  |
  Phone            ESP32 Nodes             Phone          ESP32 Nodes
  (media server)   (DMX out)               (media server)  (DMX out)
  192.168.4.2      192.168.4.x             192.168.4.2     192.168.4.x
```

---

## Components

### 1. Front-End — Customer-Facing Web App

**Output:** GitHub repo | **Runtime:** Browser (served by Media Server)

The customer scans a QR code on the physical decoration and gets a web page to interact with their deco.

#### 1.1 Grid View

Grid of available animations for the decoration. Tap to swap the animation on the real hardware.

| Feature | Description |
|---------|-------------|
| Animation thumbnails | B&W static thumbnails in a grid |
| Hover preview | On hover/long-press: colorize and animate the thumbnail |
| Tap to activate | Sends the selected animation to the media server → pushes to node |
| Fullscreen playback | After selection, animation goes fullscreen with trigger list overlay |
| QR routing | Each deco has a unique QR → the page knows which node/controller to target |

**Tech:** Static HTML/JS, WebSocket or REST to media server, canvas/video for previews.

#### 1.2 Editor — Sequence Builder

Build animation sequences by arranging predefined FX in order. Primarily for single-channel RGB LED strings that have built-in effect lists (DMX channel → effect index).

| Feature | Description |
|---------|-------------|
| FX library | List of available effects for the LED type (chase, fade, rainbow, etc.) |
| Timeline / playlist | Drag-and-drop ordering of effects with duration per step |
| Preview | Simulated preview of the sequence |
| Export | Save as playable sequence on the media server |

**Tech:** Drag-and-drop UI, predefined FX metadata per LED type.

#### 1.3 Trigger List / Calendar

Schedule when animations play. Uses LLM to convert natural language to calendar events.

| Feature | Description |
|---------|-------------|
| Natural language input | "Every other Thursday starting from this Thursday but not in June and July" |
| LLM parsing | Converts text → iCal-style recurrence rules |
| Calendar view | Visual calendar showing scheduled events |
| Manual editing | Add, remove, modify individual events after LLM generates them |
| Per-deco assignment | Each trigger maps to a deco + animation |

**Tech:** LLM API for NLP parsing, calendar UI component, cron/ical storage on media server.

#### 1.4 Finger Paint

Live painting tool — draw directly on the decoration in real-time.

| Feature | Description |
|---------|-------------|
| Canvas editor | Touch/mouse drawing on a representation of the LED layout |
| Brush tools | Color picker, brush size, eraser |
| Stencils | Predefined shapes (flags, patterns, symbols) that snap to the LED grid |
| Live output | Painted pixels stream to the node in real-time |
| Save | Save painted frame as a static animation |

**Tech:** Canvas 2D, real-time WebSocket to media server, LED layout from mapping data.

---

### 2. Admin Panel — Vanasti Backend

**Output:** GitHub repo | **Runtime:** Browser (served by Media Server)

#### 2.1 Mapping Tool (current project — Le-Dat-Converter)

Map video/image content to physical LED strip positions. Generate `.dat` files for controllers.

| Feature | Status | Notes |
|---------|--------|-------|
| Video/image import | Done | Frame extraction, JPEG cache |
| Controller/port hierarchy | Done | Multi-controller support (8 ports each) |
| Polyline point editing | Done | Click/drag, coordinate inputs, multi-select |
| Transform tools | Done | Offset, rotate, scale selected points |
| Pan/zoom viewport | Done | Middle-click, scroll wheel, touch pinch, toolbar modes |
| Fullscreen viewer | Done | Aspect-ratio preserving |
| Per-port preview rendering | Done | LED strip preview with axes |
| In/out point trimming | Done | Frame range selection |
| Loop blend | Done | Crossfade N frames for seamless loops |
| Playback with loop | Done | Play/pause/stop/seek/loop |
| .dat export | Done | Multi-controller, gamma 2.2, BGR interleave |
| Scene save/load (.zip) | Done | Full state serialization |
| Save/Load coordinates | Done | Copy/paste normalized coords |
| Template header support | Done | Reuse LEDBuild headers |
| **Live preview** | TODO | Stream mapping output to real hardware in real-time |
| **New DAT samples** | TODO | Generate samples with correct controller configs |

#### 2.2 Controller Config

Manage the network of ESP32 nodes. Each node has one output port but uses the 8-port controller addressing for backward compatibility.

| Feature | Description |
|---------|-------------|
| Node discovery | Auto-discover ESP32 nodes on the network (mDNS / UDP broadcast) |
| Port addressing | Each ESP has a `controller:port` address (e.g., 1:3 = controller 1, port 3) |
| Node list | View all nodes: online/offline status, address, firmware version |
| Address assignment | Assign/reassign controller:port addresses to physical nodes |
| Add/remove nodes | Register new nodes, decommission old ones |
| Replace node | Swap a failed node — new node inherits the old address |
| Firmware update | OTA firmware push to nodes |
| Health monitoring | Connection status, error logs, uptime |

**Tech:** REST API to media server, mDNS/UDP for discovery, OTA update protocol.

---

### 3. ESP32 Hardware

**Output:** Fusion 360 (enclosure/electronics), GitHub (firmware)

#### 3.1 DMX Node

ESP32-based controller node that receives animation data over WiFi and outputs DMX to LED controllers.

| Component | Description |
|-----------|-------------|
| MCU | ESP32 (WiFi + GPIO) |
| Protocol out | DMX512 via RS-485 transceiver to H801RC/QED3110 |
| Power | 230V passthrough (relay-switched), internal PSU for logic |
| Enclosure | IP65/IP67 rated for outdoor decorations |
| Connectivity | WiFi client on AP network |
| Addressing | Configurable controller:port address (stored in flash) |

**Firmware features:**
- WiFi connection management (auto-reconnect, AP fallback for config)
- Receive animation frames from media server (WebSocket or UDP)
- Buffer and output DMX frames at configured FPS
- Store last animation in flash (survives power cycle)
- OTA firmware updates
- Status LED / heartbeat

#### 3.2 WiFi AP (ESP32 Atom)

Dedicated ESP32 Atom that creates the local WiFi network and captive portal. Minimal firmware (~50 lines).

| Component | Description |
|-----------|-------------|
| MCU | ESP32 Atom S3 (or similar small form factor) |
| Role | WiFi SoftAP + DNS server |
| Captive portal | Redirects all DNS to the phone's static IP |
| Power | USB from phone or decoration PSU |
| Config | SSID, password, phone IP stored in flash |

**Firmware:** `WiFi.softAP()` + `DNSServer` pointing all queries to the phone's IP. No web server, no application logic.

---

### 4. Media Server — Pi / Android

**Output:** GitHub repo

Central server that stores animations, manages nodes, and serves the front-end and admin web apps. Runs on Raspberry Pi or Android device. IP65 enclosure for outdoor installation.

| Feature | Description |
|-----------|-------------|
| Animation storage | Store `.dat` files and metadata (name, thumbnail, tags) |
| Node management | Track registered nodes, push animations, monitor health |
| Web server | Serve front-end and admin static files |
| API | REST/WebSocket API for all operations |
| Scheduler | Execute trigger/calendar events (start/stop animations on schedule) |
| Live relay | Relay finger-paint and live control data to nodes in real-time |
| QR generation | Generate QR codes linking to per-deco front-end pages |
| Persistence | SQLite or file-based storage for config, schedules, animations |

**Tech:** Python (Flask/FastAPI), SQLite, WebSocket for real-time, systemd service.

---

## Timeline — 48 Weeks

Working at **60% capacity** (~3 days/week). Calendar weeks include the 60% factor. The mapping tool (Phase 0) was completed in 1 week at full speed as a reference.

| Phase | Component | Scope | Calendar Weeks |
|-------|-----------|-------|----------------|
| **Phase 0** | Mapping Tool | Le-Dat-Converter — done | done |
| **Phase 1** | ESP32 AP Firmware | WiFi SoftAP + DNS captive portal (~50 lines) | Wk 1 |
| **Phase 2** | ESP32 DMX Node | WiFi client, frame buffer, DMX output, addressing, OTA | Wk 1–8 |
| **Phase 3** | Media Server Core | FastAPI, animation storage, node management, discovery, WebSocket | Wk 4–14 |
| **Phase 4** | QR + Connectivity | QR generation, captive portal flow, Cloudflare Tunnel setup | Wk 12–15 |
| **Phase 5** | Controller Config UI | Node list, address assignment, add/remove/replace, health | Wk 15–19 |
| **Phase 6** | Grid View | Animation grid, hover preview, tap-to-activate, fullscreen | Wk 18–24 |
| **Phase 7** | Mapping Live Preview | Stream mapping to real hardware in real-time | Wk 22–25 |
| **Phase 8** | Trigger / Calendar | LLM text parsing, calendar UI, scheduler backend | Wk 25–32 |
| **Phase 9** | Editor | FX library, sequence builder, preview | Wk 30–35 |
| **Phase 10** | Finger Paint | Canvas editor, stencils, live streaming to nodes | Wk 33–38 |
| **Phase 11** | Hardware | PCB, enclosure (IP65), 230V, RS-485 (runs in parallel) | Wk 5–20 |
| **Phase 12** | Integration & Field Test | End-to-end with real decorations, bug fixes, polish | Wk 39–48 |

### Schedule (48 weeks, Gantt-style)

```
Week  1         10        20        30        40       48
      |---------|---------|---------|---------|--------|
P0  ■ done
P1  ■ AP firmware
P2  ████████ DMX node firmware
P3      ███████████ media server
P4              ████ QR + connectivity
P5                █████ controller config
P6                   ███████ grid view
P7                       ████ live preview
P8                           ████████ triggers/calendar
P9                               ██████ editor
P10                                 ██████ finger paint
P11   ████████████████ hardware (parallel)
P12                                        ██████████ integration
```

### Critical path

```
P0 (done) → P1 (AP) → P2 (DMX node) ─┐
                                       ├→ P3 (server) → P4 (QR) → P5 (config)
                                       │                    │
                                       │                    └→ P6 (grid) → P7 (live preview)
                                       │                                        │
                                       │                    P8 (triggers) ◄─────┘
                                       │                    P9 (editor) ◄───────┘
                                       │                    P10 (paint) ◄───────┘
                                       │                                        │
P11 (hardware, parallel) ──────────────┘                    P12 (integration) ◄─┘
```

**P2 + P3 are the critical path** — everything else depends on working nodes and a server. Hardware (P11) runs in parallel from week 5. The final 10 weeks (39–48) are dedicated to integration testing with real outdoor installations.

---

## Repositories

| Repo | Contents |
|------|----------|
| `Le-Dat-Converter` (this repo) | Mapping tool, .dat format libraries (JS + Python), format docs |
| `smartled-frontend` | Grid view, editor, triggers, finger paint (static web app) |
| `smartled-admin` | Controller config UI (static web app, could merge with frontend) |
| `smartled-node` | ESP32 DMX node Arduino firmware |
| `smartled-ap` | ESP32 Atom WiFi AP + captive portal firmware (tiny) |
| `smartled-server` | Media server (Python), API, scheduler, node management |

---

## Tech Stack Summary

| Layer | Technology |
|-------|------------|
| Front-end | Vanilla JS/HTML/CSS (no framework, like current project) |
| Admin | Vanilla JS/HTML/CSS |
| Media Server | Python (FastAPI), SQLite, WebSocket |
| Node Firmware | Arduino (ESP32), DMX library, WiFi, OTA |
| Hardware | ESP32, RS-485, 230V relay, IP65/67 enclosure |
| LLM (triggers) | API call to Claude or similar for NL → calendar parsing |
| Protocol (server↔node) | WebSocket or UDP for frame data, REST for config |

---

## Connectivity & QR Access

Two ways for customers to reach the front-end, each via a single QR code on the decoration.

### Option A: Local — WiFi QR Code + Captive Portal

For installations without internet. A dedicated ESP32 Atom creates the local WiFi network.

```
QR Code content (WiFi format):
  WIFI:T:WPA;S:DECO-TREE-01;P:sparkle123;;

Phone scans → auto-connects to WiFi → captive portal opens → grid view
```

| Component | Role |
|-----------|------|
| ESP32 Atom | WiFi SoftAP + DNS server. Redirects all DNS queries to the phone's static IP (e.g. 192.168.4.2). No web server, no storage — just a router. ~50 lines of firmware. |
| Android phone | Connected as WiFi client at 192.168.4.2. Runs the media server (Python), stores animations, coordinates nodes. Has battery, storage, and cell modem. |
| ESP32 DMX nodes | Connected as WiFi clients. Receive frames from phone, output DMX. |

**How the captive portal works:**
1. ESP32 Atom runs `WiFi.softAP("DECO-TREE-01", "sparkle123")`
2. DNS server responds to ALL queries with the phone's IP (192.168.4.2)
3. When the customer's phone connects, the OS detects the captive portal (via `connectivitycheck.gstatic.com` → wrong IP) and auto-opens a browser window
4. Browser loads `http://192.168.4.2/` → the phone's web server returns the grid view

### Option B: Remote — URL QR Code + Reverse Tunnel

For installations with internet access, or for remote admin.

```
QR Code content (URL format):
  https://tree-01.example.com

Phone scans → opens browser → loads page via tunnel → grid view
```

| Component | Role |
|-----------|------|
| Cloudflare Tunnel | Free reverse tunnel. Phone runs `cloudflared` to expose its local web server at a public URL. No port forwarding needed. |
| Android phone | Runs media server + `cloudflared`. Accessible from anywhere via the public URL. |
| ESP32 DMX nodes | Same as local — connected via the ESP32 Atom's WiFi. |

**Alternatives to Cloudflare Tunnel:** frp (self-hosted), ngrok, Tailscale (for admin-only VPN access).

### QR Code Generation

The media server generates both QR codes per decoration:

| QR Type | Format | When to use |
|---------|--------|-------------|
| WiFi QR | `WIFI:T:WPA;S:{ssid};P:{password};;` | Print on deco label for local access |
| URL QR | `https://{deco-id}.example.com` | Print on deco label for remote access, or share digitally |

Both QR codes can be printed side-by-side on the decoration's label with icons (WiFi symbol / globe symbol) so the customer picks the right one. The front-end page is identical — same grid view, same controls — regardless of how they got there.

### Dual-Mode Operation

The phone can run both modes simultaneously:
- **WiFi client** on the ESP32 Atom's network (local access, node control)
- **Cell data** for Cloudflare Tunnel (remote access)

Android supports WiFi + cellular at the same time, so one phone handles everything.

---

## DMX Node — Hardware Architecture

Each ESP32 DMX node drives 8 independent DMX512 outputs using an RP2040 as a dedicated I/O coprocessor.

```
ESP32 ──SPI──► RP2040 ──8× GPIO──► 8× 6N137 ──► 8× MAX3485 ──► 8× DMX out
(WiFi +         (PIO: 8            (opto-         (RS-485        (RJ45)
 brain)          UART TX)           isolation)     driver)
```

### Why RP2040?

- 2 PIO blocks × 4 state machines = **8 independent hardware UART TX engines**
- Each state machine runs a ~10-instruction UART TX program on its own GPIO pin
- All 8 DMX streams output in parallel — zero CPU involvement
- ESP32 sends interleaved frame data over SPI; RP2040 demuxes to 8 channels
- Maps directly to the `.dat` format: one controller = 8 ports = one node

### Signal chain per port

```
RP2040 PIO pin → 6N137 optocoupler → MAX3485 RS-485 driver → SMBJ6.0A TVS → RJ45
```

- **6N137**: galvanic isolation — prevents ground loops with 230V outdoor installations
- **MAX3485**: 3.3V RS-485 driver (TX-only: DE high, /RE high)
- **SMBJ6.0A**: ESD/surge clamp on the DMX line
- **120Ω termination resistor** on each port

---

## Budget — 50 Test Units (DMX Node)

Proposed budget for building the first 50 8-port DMX nodes for field testing.

### 1. Components & PCB Fabrication

| Item | Cost |
|------|------|
| Electronic components (BOM × 50) | $1,100 |
| PCB fabrication + SMT assembly (JLCPCB) | $225 |
| Connectors (RJ45, terminals, headers) | $185 |
| Spare parts buffer (10%) | $150 |
| Shipping (LCSC/JLCPCB) | $80 |
| **Subtotal** | **$1,740** |

### 2. Electronics Design (outsource)

| Item | Hours | Rate | Cost |
|------|-------|------|------|
| Schematic (ESP32 + RP2040 + 8ch opto/485) | 30 | $75/hr | $2,250 |
| PCB layout (2-layer, production ready) | 25 | $75/hr | $1,875 |
| Design review + revisions | 10 | $75/hr | $750 |
| Prototype run (5 boards before batch) | — | — | $200 |
| **Subtotal** | **65 hrs** | | **$5,075** |

### 3. 3D Printing (enclosures)

| Item | Cost |
|------|------|
| Filament/material (PETG or ASA for outdoor use) | $300 |
| Print time electricity (~3–4 hrs/unit × 50) | $50 |
| Gaskets/seals for IP65 rating | $150 |
| Hardware (screws, standoffs, cable glands) | $200 |
| **Subtotal** | **$700** |

### 4. External Consulting (contingency)

| Item | Cost |
|------|------|
| EE review (schematic + PCB sign-off) | $1,000 |
| EMC pre-compliance check | $1,000 |
| 230V safety review (if adding mains power) | $1,000 |
| General troubleshooting buffer | $1,000 |
| **Subtotal** | **$4,000** |

### Budget Summary

| Category | Cost |
|----------|------|
| Components & PCB | $1,740 |
| Electronics design (outsource) | $5,075 |
| 3D printing (enclosures) | $700 |
| External consulting | $4,000 |
| **Total** | **$11,515** |

Per-unit cost: **~$230** (including one-time design and consulting amortized across 50 units). At scale (500+ units), per-unit drops to ~$50 as one-time costs amortize.
