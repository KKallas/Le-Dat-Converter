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

**Strategy:** Front-end mockup first for stakeholder approval, then hardware + firmware in parallel to get physical output as early as possible. Each phase delivers a functional system and requires sign-off before proceeding.

| Phase | System | Deadline | Depends on |
|-------|--------|----------|------------|
| **P1** | DAT File Software | done | — |
| **P2** | Slave Control System | Wk 12 | P1 |
| **P3** | Master Control System | Wk 20 | P2 |
| **P4** | Grid Preview System | Wk 28 | P3 |
| **P5** | Trigger System | Wk 36 | P4 |
| **P6** | Finger Paint System | Wk 42 | P4 |
| **P7** | Controller Management & Field Test | Wk 48 | All |

---

### Phase 1 — DAT File Software ✅

**Status:** Done

Software tool to convert video/images into .dat animation files for LED controllers.

**Acceptance checklist — is it done?**

- [ ] Open the tool in a browser. Does it load without errors?
- [ ] Drag a video file onto the page. Do frames appear?
- [ ] Add a controller, add ports, draw polylines on the image. Do LED strip previews show colored dots?
- [ ] Press Play. Does the preview animate through the frames?
- [ ] Set in/out points. Does playback only play the trimmed range?
- [ ] Enable loop. Does it loop without a visible seam?
- [ ] Click Export. Does a .dat file download?
- [ ] Drop the dat file to SD card and try it out on test controller set
- [ ] Save the scene as .zip. Close the tab. Open a new tab and load the .zip. Is everything restored?

---

### Phase 2 — Slave Control System

**Deadline:** Wk 12

The physical DMX node hardware: PCB design, enclosure, ESP32 + RP2040 firmware, and 50 assembled units. After this phase, you have boxes that receive data over WiFi and output DMX to LED strips.

Includes: hardware design, PCB fabrication, 3D enclosure, node firmware (ESP32 WiFi + RP2040 8× PIO DMX), assembly of 50 test units.

**Acceptance checklist — is it done?**

- [ ] Pick up a finished node. Is it in an enclosed box with 8× TBA ports, a power connector, and a status LED?
- [ ] Plug in power. Does the status LED turn green and pulse slowly
- [ ] If you hold down the button for ten seconds the led will blink bright once every second. Then the device will reboot in config mode AP. Connect to the node's WiFi fallback AP. Can you open a config page and set the WiFi network + controller address?
- [ ] Switch the node to client mode. Does it appear on the WiFi network?
- [ ] Make sure all 8 channels are sepparetly configurable and output smartled dmx/3110 data
- [ ] Unplug power, plug back in. Does the node reconnect to WiFi and resume working automatically?
- [ ] Are there 50 assembled, tested, labeled nodes (production table link)?

---

### Phase 3 — Master Control System

**Deadline:** Wk 20

The central server running on the phone, WiFi access point, QR code access, and remote tunnel. After this phase, the full infrastructure works: phone stores and streams animations to nodes, customers can connect via QR code.

Includes: ESP32 AP firmware (captive portal), media server (FastAPI, animation storage, node registry, WebSocket streaming), QR generation, Cloudflare Tunnel.

**Acceptance checklist — is it done?**

- [ ] Power on the ESP32 Atom AP. Does a WiFi network appear?
- [ ] Scan the WiFi QR code with a phone. Does it auto-connect and open a web page?
- [ ] Open the media server admin. Can you upload media file to be used for light mapping.
- [ ] Can you store new .dat animation, does it show up in playback list
- [ ] Can you see all connected nodes in the node list (online/offline)?
- [ ] Select an animation. Do the LEDs on that node start playing the animation?
- [ ] Stop playback. Do the LEDs stop?
- [ ] Upload a second animation. Switch between them. Do the LEDs change accordingly?
- [ ] Scan the URL QR code on a phone using cell data (WiFi off). Does the page load via the internet?
- [ ] Generate a printable QR label (PDF).

---

### Phase 4 — Grid Preview System

**Deadline:** Wk 28

Customer-facing animation selection screen and live preview from the mapping tool. After this phase, a customer can scan a QR code, browse animations in a grid, tap to play one, and the mapping tool can preview directly to hardware.

Includes: front-end mockup (for approval), grid view, mapping tool live preview.

**Acceptance checklist — is it done?**

- [ ] Scan the decoration's QR code with any phone. Does a grid view open up?
- [ ] Touch and hold a thumbnail. Does an animated preview play?
- [ ] Tap a thumbnail. Do the actual LEDs on the decoration change to that animation?
- [ ] Does the selected animation play fullscreen on the phone?
- [ ] Try on an iPhone (Safari). Does everything work?
- [ ] Try on an Android phone (Chrome). Does everything work?
- [ ] Try on a desktop browser. Does everything work?
- [ ] Open Le-Dat-Converter, load a scene, click "Live Preview". Do the LEDs update as you move points around?
- [ ] Is the live preview smooth (no visible stutter)?

---

### Phase 5 — Trigger System

**Deadline:** Wk 36

Scheduling, automation, and the sequence editor. After this phase, animations can run on a schedule and users can build custom sequences from effects.

Includes: natural language trigger input (LLM-powered), calendar UI, scheduler backend, FX library, sequence builder.

**Acceptance checklist — is it done?**

- [ ] Open the trigger page. Type "every Friday at 6pm play rainbow". Does a calendar event appear?
- [ ] Does the calendar show the event on the correct day and time?
- [ ] Wait for the scheduled time (or set it to 1 minute from now). Does the animation start playing automatically?
- [ ] Add a second trigger for a different animation. Do both fire at their scheduled times?
- [ ] Edit an existing trigger. Change the time. Does the calendar update?
- [ ] Delete a trigger. Is it removed from the calendar and does it stop firing?
- [ ] Open the sequence editor. Are there effects to choose from (chase, fade, rainbow, etc.)?
- [ ] Drag effects into a timeline. Set durations. Does the preview play the sequence?
- [ ] Save the sequence. Does it appear in the animation grid alongside the uploaded .dat files?
- [ ] Select the sequence on the grid. Does it play on the LEDs?

---

### Phase 6 — Finger Paint System

**Deadline:** Wk 42

Live drawing tool — paint on the LED decoration in real-time from a phone or tablet.

Includes: canvas editor, brush tools, color picker, stencils, real-time streaming to nodes.

**Acceptance checklist — is it done?**

- [ ] Open the finger paint page. Does a canvas appear showing the LED layout?
- [ ] Pick a color and draw with your finger/mouse. Do strokes appear on the canvas?
- [ ] Do the LEDs on the decoration update live as you draw?
- [ ] Change brush size. Does the stroke width change?
- [ ] Use the eraser. Does it clear painted areas?
- [ ] Open the stencil panel. Select a shape (star, flag, etc.). Can you paint it on?
- [ ] Tap "Save". Does the current canvas save as a static animation on the server?
- [ ] Does the saved painting appear in the animation grid?
- [ ] Clear the canvas. Is everything wiped?

---

### Phase 7 — Controller Management & Field Test

**Deadline:** Wk 48

Admin tools for managing the node network, firmware updates, and end-to-end field testing on a real outdoor installation.

Includes: controller config UI (node list, addressing, health, OTA), field deployment, stability testing, documentation.

**Acceptance checklist — is it done?**

- [ ] Open the admin panel. Are all 50 nodes listed with online/offline status?
- [ ] Click a node. Can you see its controller:port address, uptime, and error count?
- [ ] Change a node's ports, do leds update accordingly
- [ ] Unplug a node. Does the admin panel show it as offline within 30 seconds?
- [ ] Plug in a brand new node. Can you register it and assign an address from the admin panel?
- [ ] Select a node and push a firmware update. Does the OTA complete and the node reboot with new firmware?
- [ ] Mark a node as "replace". Plug in a new node. Does it inherit the old node's address?
- [ ] Deploy the full system on a real outdoor decoration. Does everything work end-to-end?
- [ ] Leave it running for 48 hours. Does it stay stable (no crashes, no memory leaks, auto-reconnects)?

### Schedule (48 weeks, Gantt-style)

```
Week  1         10        20        30        40       48
      |---------|---------|---------|---------|--------|
P1  ■ done (DAT file software)
P2  ████████████ slave control system
P3            ████████████ master control system
P4                      ████████ grid preview system
P5                              ████████ trigger system
P6                                  ████████ finger paint system
P7                                          ████████ controller mgmt + field test
```

### Critical path

```
P1 (done) → P2 (slave) → P3 (master) → P4 (grid preview) → P7 (mgmt + field test)
                                              │
                                              ├→ P5 (triggers)
                                              └→ P6 (finger paint)
```
```

**P1 (mockup) is the first gate** — stakeholder approval before committing to build. Hardware design (P2) starts in parallel during Wk 2 so PCBs arrive by Wk 10. **P4 + P5 are the critical software path** — working nodes and server unlock everything else. First physical DMX output targets **Wk 12** (prototype boards + firmware ready).

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

Proposed budget for building the first 50 8-port DMX nodes for field testing. Electronics design (schematic, PCB layout) and mechanical design (enclosure CAD, 3D printing) are covered under project salary. This budget covers materials, fabrication, and external consulting only.

### 1. Components & PCB Fabrication

| Item | Cost |
|------|------|
| Electronic components (BOM × 50) | $1,100 |
| PCB fabrication + SMT assembly (JLCPCB) | $225 |
| Connectors (RJ45, terminals, headers) | $185 |
| Prototype run (5 boards before batch) | $200 |
| Spare parts buffer (10%) | $150 |
| Shipping (LCSC/JLCPCB) | $80 |
| **Subtotal** | **$1,940** |

### 2. Enclosure Materials

| Item | Cost |
|------|------|
| Filament/material (PETG or ASA for outdoor use) | $300 |
| Gaskets/seals for IP65 rating | $150 |
| Hardware (screws, standoffs, cable glands) | $200 |
| **Subtotal** | **$650** |

### 3. External Consulting — Electrical

| Item | Cost |
|------|------|
| EE review (schematic + PCB sign-off) | $1,500 |
| EMC pre-compliance check | $1,500 |
| 230V safety review (if adding mains power) | $1,000 |
| General troubleshooting buffer | $1,000 |
| **Subtotal** | **$5,000** |

### 4. External Consulting — Mechanical Design & Packaging

| Item | Cost |
|------|------|
| Enclosure design review (IP65, thermal, structural) | $1,000 |
| Packaging design (labeling, print templates, boxing) | $1,000 |
| Material/process consultation (outdoor durability) | $1,000 |
| **Subtotal** | **$3,000** |

### Budget Summary (50 test units)

| Category | Cost |
|----------|------|
| Components & PCB fabrication | €1,800 |
| Enclosure materials | €600 |
| Consulting — electrical | €4,650 |
| Consulting — mechanical & packaging | €2,790 |
| **Total materials + consulting** | **€9,840** |

### Development Investment

The full development (firmware, media server, front-end, admin panel, hardware design) is required to make the DMX node a functional product. All phases are amortized into the unit cost.

| Item | Cost |
|------|------|
| Salary (employer cost: €4,800/month × 12 months × 60%) | €34,560 |
| Materials + consulting (50 test units) | €9,840 |
| **Total development investment** | **€44,400** |

### Production Unit Cost (200 pc/batch)

At 200-unit batch volumes, component and fabrication costs drop with volume pricing.

| Item | Per unit |
|------|----------|
| Electronic components (volume pricing) | €13 |
| PCB fabrication + SMT assembly | €3 |
| Connectors (RJ45, terminals, headers) | €3 |
| Enclosure (3D printed PETG/ASA) | €4 |
| Gaskets, seals, cable glands | €2 |
| Hardware (screws, standoffs) | €2 |
| Shipping + overhead | €1 |
| **Production cost per unit** | **€28** |

Cost per 200-unit batch: **€5,600**

### Unit Cost with Development Amortized (10,000 units)

| | Per unit | Notes |
|--|----------|-------|
| Production cost | €28 | 200 pc/batch |
| Development amortized | €4.44 | €44,400 ÷ 10,000 |
| **Total cost per unit** | **€32.44** | |

At 10K units with injection-molded enclosures (~€4,000 tooling), production cost drops to ~€22/unit → **€26.44/unit** fully loaded.
