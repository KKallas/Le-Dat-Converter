# Save/Load Tool

Copy and paste port polyline coordinates as normalized tab-separated values. Found in the rack sidebar under each port via the dropdown.

## Usage

1. Expand a port in the rack sidebar
2. Switch the dropdown from "Points" to "Save/Load"
3. The textarea shows current point coordinates in normalized form (0.0 to 1.0)
4. Click **Copy** to copy coordinates to clipboard
5. Paste coordinates from another source into the textarea
6. Click **Load** to apply the pasted coordinates to the port

## Format

Each line is one point: `X<tab>Y` where X and Y are normalized (0.0 = left/top, 1.0 = right/bottom).

```
0.100000	0.500000
0.900000	0.500000
```

Comma-separated and space-separated values also work.

## Plugin Contract

This is a **controller tool** — it operates on a single port's polyline in the rack sidebar.

Controller tools live in `tools/controller/<name>/tool.js` and export:

```javascript
export default {
  name: "saveload",
  label: "Save/Load",
  renderPanel(container, port, portIdx, api) { ... }
};
```

To register a new controller tool, add it to `tools/controller/registry.js`.

## Tips

- Coordinates are normalized to the media dimensions, so they transfer between different resolution sources
- You need at least 2 points for a valid polyline
- After loading, the port automatically switches back to Points mode
