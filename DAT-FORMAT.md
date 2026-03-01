# .DAT File Format Reference

Binary format used by H803TC / H801RC / H801RA / H802RA LED controllers.
Produced by LEDBuild software.

---

## File Layout

```
[ 512-byte Header ] [ Frame 0 (padded) ] [ Frame 1 (padded) ] [ Frame 2 ... ]
```

- Header: exactly **512 bytes**.
- Each frame is padded with zero bytes to a **512-byte boundary**.
- No frame count stored — the controller reads until EOF.

---

## Header (512 bytes)

| Offset | Size | Description |
|--------|------|-------------|
| 0x00 - 0x03 | 4 | Magic: `00 00 48 43` |
| 0x04 - 0x07 | 4 | Fixed config: `40 40 0A 60` |
| 0x08 - 0x0B | 4 | Controller-count config (byte 0x09 changes with controller count) |
| 0x0C - 0x0F | 4 | File-specific hash (varies per export) |
| 0x10 - 0x11 | 2 | Controller/slave count (uint16 LE). 1 = one H801RC, 2 = two, etc. |
| 0x12 - 0x2B | 26 | Format config + file hash (encodes IC type; varies per export) |
| 0x2C - 0x1FF | 468 | Zero padding |

All three IC type formats (DM1812, DMX, QED3110) share the same magic and
header structure. The IC type is encoded in the config bytes at 0x12+.

### IC type identification

The top 2 bits of byte 0x12 identify the IC type:

| Bits 7-6 of byte 0x12 | IC type |
|------------------------|---------|
| `00` (0x00-0x1F) | DM1812 |
| `01` (0x40-0x5F) | DMX512 |
| `10` (0xA0-0xBF) | QED3110 |

### Controller-count config (bytes 0x08-0x0B)

Byte 0x09 changes with controller count but is the same across IC types:

| Controllers | Byte 0x09 |
|-------------|-----------|
| 1 | `0x66` |
| 2 | `0x0C` |

Bytes 0x08, 0x0A, 0x0B remain `0x40`, `0x0A`, `0x60` respectively.

### Non-reproducible bytes

Bytes 0x0C-0x0F and parts of 0x12-0x2B contain file-specific values that
change between exports from LEDBuild, even for the same format and
configuration. These appear to be a hash or checksum. The controller
hardware does not seem to validate them strictly — sample headers from
known-good LEDBuild exports work reliably.

---

## Frame Data Structure

### Fundamental unit: the group

Each frame consists of **groups** of bytes. The group size depends on the
number of controllers:

```
group_size = 8 × controller_count
```

- 1 controller (H801RC): **8-byte** groups
- 2 controllers: **16-byte** groups
- N controllers: **8N-byte** groups

### Port mapping within a group

Each controller contributes an **8-byte block** within the group.
Controller 1 occupies bytes 0–7, controller 2 occupies bytes 8–15, etc.

Within each 8-byte block, byte positions map to port slots in reverse order:

```
Block byte:   0      1      2      3      4      5      6      7
Port:        port8  port7  port6  port5  port4  port3  port2  port1
```

**Port N → byte position (8 - N)** within its controller's 8-byte block.

For multi-controller setups, the global port number maps like this:

```
Single controller (8 bytes per group):
  Byte:  0     1     2     3     4     5     6     7
  Port:  8     7     6     5     4     3     2     1

Two controllers (16 bytes per group):
  Byte:  0     1     2     3     4     5     6     7  |  8     9    10    11    12    13    14    15
  Port:  8     7     6     5     4     3     2     1  |  16    15    14    13    12    11    10     9
         ←——— Controller 1 ————————————————————————→    ←——— Controller 2 ————————————————————————→
```

### Channel order: BGR interleaved per LED

Each LED uses **3 consecutive groups** for its B, G, R channels:

```
Group 0:  LED 0, B channel  →  [ctrl1: port8_B..port1_B | ctrl2: port16_B..port9_B | ...]
Group 1:  LED 0, G channel  →  [ctrl1: port8_G..port1_G | ctrl2: port16_G..port9_G | ...]
Group 2:  LED 0, R channel  →  [ctrl1: port8_R..port1_R | ctrl2: port16_R..port9_R | ...]
Group 3:  LED 1, B channel  →  ...
Group 4:  LED 1, G channel  →  ...
Group 5:  LED 1, R channel  →  ...
...
```

### Frame size

```
group_size        = 8 × controller_count
groups_per_frame  = max_leds_per_port × 3       (one B,G,R triplet per LED)
frame_bytes       = groups_per_frame × group_size
frame_padding     = (512 - frame_bytes % 512) % 512
padded_frame      = frame_bytes + frame_padding
```

Examples:
- 1 controller, 400 LEDs/port: 400 × 3 × 8 = 9600 + 128 pad = **9728** per frame
- 2 controllers, 400 LEDs/port: 400 × 3 × 16 = 19200 + 256 pad = **19456** per frame

### Gamma correction

Values in the file are **gamma-corrected** (approximately gamma 2.2):

```
file_value = round(pow(brightness / 255.0, 2.2) * 255.0)
```

Verified data points:

| Input brightness | File value | gamma 2.2 calc |
|-----------------|------------|---------------|
| 0 | 0 | 0 |
| 35 | 3 | 3 |
| 80 | 20 | 20 |
| 125 | 53 | 53 |
| 236 | 219 | 216 (close) |
| 255 | 255 | 255 |

Small deviations at high values suggest LEDBuild may use a lookup table
rather than a pure power function.

---

## Verified Examples

### 10.dat — Single controller, 2 ports

H801RC, 1 controller, ports 1 (red) and 2 (green), 400 LEDs each, 1 frame.

```
File size:  10240 bytes (512 header + 9728 frame)
Frame:      400 LEDs × 3 channels × 8 bytes = 9600 data + 128 padding

Port 1 (red, R=255 G=0 B=0) → byte position 7:
  LED 0 B group (group 0): pos 7 = 0
  LED 0 G group (group 1): pos 7 = 0
  LED 0 R group (group 2): pos 7 = 255
  (repeats for all 400 LEDs)

Port 2 (green, R=0 G=255 B=0) → byte position 6:
  LED 0 B group (group 0): pos 6 = 0
  LED 0 G group (group 1): pos 6 = 255
  LED 0 R group (group 2): pos 6 = 0
  (repeats for all 400 LEDs)

All other byte positions = 0 (unused ports)
```

### 15.dat — Two controllers, 9 ports

2 controllers, 9 configured outputs, 400 max LEDs/port, 1 frame.

```
File size:     19968 bytes (512 header + 19456 frame)
Header 0x10:   02 00 (controller count = 2)
Group size:    16 bytes (8 × 2 controllers)
Frame:         400 LEDs × 3 channels × 16 bytes = 19200 data + 256 padding

Controller 1 (bytes 0–7):  8 ports, green (200–400 LEDs each)
Controller 2 (bytes 8–15): port 9 = red (400 LEDs), ports 10–16 unused

LED 0 example (16-byte groups):
  B group: [00×8 | 00×8]         →  B=0 all ports
  G group: [FF×8 | 00×8]         →  G=255 ctrl1 ports, G=0 ctrl2
  R group: [00×8 | FF×8]         →  R=0 ctrl1, R=255 ctrl2 port 9
```

---

## Hardware

| Controller | Role | Max Pixels | Ports |
|-----------|------|------------|-------|
| H803TC | Master | 170,000 | - |
| H801RC | Slave | 8,192 | 8 |
| H801RA | Slave | 3,412 | 4 |
| H802RA | Slave | 4,096 | 4 |

---

## IC Type Formats

All three formats share the **same frame encoding** — reversed port byte order,
BGR channel interleaving, and gamma 2.2 correction. The only difference between
DM1812, DMX, and QED3110 is the header bytes that identify the IC type to the
controller hardware.

| Format | IC Type | Header difference |
|--------|---------|-------------------|
| DM1812 | DM1812 LED driver | Byte 0x12 top bits = `00` |
| DMX | DMX512 protocol | Byte 0x12 top bits = `01` |
| QED3110 | QED3110 LED driver | Byte 0x12 top bits = `10` |

---

## Open Questions

- Exact gamma curve: pure 2.2 power or custom lookup table? High-value deviation.
- H801RA/H802RA (4 ports): same 8-byte stride or 4-byte stride?
- Full meaning of the hash/config bytes at 0x0C-0x0F and 0x12-0x2B.
- Controller-count byte 0x09 values for 3+ controllers.
