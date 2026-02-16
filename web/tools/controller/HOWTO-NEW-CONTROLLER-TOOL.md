# How to Write a Controller Tool

Controller tools operate on a **single port's polyline** in the **rack sidebar**. Each port has a dropdown to switch between controller tools. The tool renders its panel inside the port's collapsible body.

**Reference implementations:**
- `points/tool.js` — point editing with add/remove/drag
- `saveload/tool.js` — copy/paste normalized coordinates

## Quick Start

1. Create `tools/controller/mytool/tool.js`
2. Add one import line to `tools/controller/registry.js`
3. Done — reload the page, expand a port, pick your tool from the dropdown

## Step 1: Create the tool file

Create `tools/controller/<name>/tool.js`:

```javascript
// tools/controller/mytool/tool.js

export default {
  name: "mytool",     // unique key (stored in port.editMode)
  label: "My Tool",   // shown in per-port dropdown

  renderPanel(container, port, portIdx, api) {
    // container — the port's body div in the rack sidebar
    // port      — the port data object { leds, points, ... }
    // portIdx   — flat index of this port across all controllers
    // api       — { state, actions } for reading state and triggering side effects

    const { activeSelection, mediaW, mediaH, isPointSelected } = api.state;
    const { setSelection, toggleSelection, markPortDirty, drawOverlay,
            updateLinePreviews, renderRack, addPointToPort, removePointFromPort } = api.actions;

    // Build your UI here.
    // Append DOM elements to `container`.

    const info = document.createElement("div");
    info.textContent = `Port ${portIdx}: ${port.points.length} points, ${port.leds} LEDs`;
    container.appendChild(info);

    // Example: a button that does something
    const btn = document.createElement("button");
    btn.className = "btn-small btn-primary";
    btn.textContent = "Do Something";
    btn.addEventListener("click", () => {
      // Modify port.points directly, then notify the system:
      markPortDirty(port);
      renderRack();
      drawOverlay();
      updateLinePreviews();
    });
    container.appendChild(btn);
  },
};
```

## Step 2: Register in the registry

Edit `tools/controller/registry.js`:

```javascript
import points from "./points/tool.js";
import saveload from "./saveload/tool.js";
import mytool from "./mytool/tool.js";       // <-- add this

export default [points, saveload, mytool];    // <-- add to array
```

The rack sidebar auto-generates the per-port dropdown from this array. The first tool in the array is the default for new ports.

## API Reference

### `api.state` — Read-only state accessors

| Property | Type | Description |
|---|---|---|
| `activeSelection` | `{port, point}\|null` | Currently focused point |
| `mediaW` | `number` | Media width in pixels |
| `mediaH` | `number` | Media height in pixels |
| `isPointSelected(pi, pti)` | `function` | Check if a point is in the global multi-selection |

### `api.actions` — Mutation callbacks

| Action | Signature | Description |
|---|---|---|
| `setSelection({port, point})` | `(sel) => void` | Select a single point (clears multi-selection) |
| `toggleSelection(portIdx, pointIdx)` | `(pi, pti) => void` | Toggle a point in/out of multi-selection |
| `markPortDirty(port)` | `(Port) => void` | Mark port's preview as needing re-render |
| `drawOverlay()` | `() => void` | Redraw viewport overlay |
| `updateLinePreviews()` | `() => void` | Redraw per-port line preview strips |
| `renderRack()` | `() => void` | Re-render the entire rack sidebar |
| `addPointToPort(portIdx)` | `(pi) => void` | Add a new point to the port |
| `removePointFromPort(portIdx, pointIdx)` | `(pi, pti) => void` | Remove a point from the port |

## Port Data Model

The `port` object you receive has these fields:

```javascript
{
  leds: 400,              // number of LEDs on this strip
  points: [               // polyline vertices (pixel coordinates)
    { x: 100, y: 200 },
    { x: 300, y: 200 },
  ],
  collapsed: false,       // sidebar collapse state
  previewCollapsed: true,  // preview section collapse state
  editMode: "mytool",     // which controller tool is active (your name)
  trimStart: 0,           // LEDs to skip at start
  trimEnd: 0,             // LEDs to skip at end
}
```

You can modify `port.points` directly (they're live references). After modifying, call `markPortDirty(port)` to flag the preview as stale.

## Switching Modes

To switch the port back to another tool (e.g. after loading data):

```javascript
port.editMode = "points";
renderRack();
```

The rack re-renders and the dropdown switches to the Points tool. See `saveload/tool.js` for a real example of this pattern.

## Importing from Port Model

If you need utility functions from the port model:

```javascript
import { parseSaveLoadText } from "../../../rack/port-model.js";
```

Note the path: controller tools are 3 levels deep (`tools/controller/mytool/tool.js`), so the import to `rack/` needs `../../../`.

## CSS Classes Available

| Class | Element | Description |
|---|---|---|
| `points-list` | `div` | Container for a list of point rows |
| `point-row` | `div` | Row container with flexbox layout |
| `point-label` | `span` | Label text (e.g. "A", "B") |
| `coord-input` | `input` | Styled number input for coordinates |
| `point-actions` | `div` | Button row below the points list |
| `transform-actions` | `div` | Button group (same flex style) |
| `saveload-textarea` | `textarea` | Styled textarea for text input |
| `btn-small` | `button` | Small button |
| `btn-small btn-primary` | `button` | Small primary (blue) button |
| `btn-danger` | `button` | Danger (red) button |
| `active` | added to row | Highlights row as focused |

## Patterns from Existing Tools

### Points tool pattern — interactive list with selection

```javascript
port.points.forEach((pt, pti) => {
  const row = document.createElement("div");
  row.className = "point-row";

  // Shift+click for multi-select, plain click for single select
  row.addEventListener("click", (e) => {
    if (e.shiftKey) toggleSelection(portIdx, pti);
    else setSelection({ port: portIdx, point: pti });
    renderRack();
    drawOverlay();
  });

  container.appendChild(row);
});
```

### Save/Load tool pattern — textarea with import/export

```javascript
const ta = document.createElement("textarea");
ta.className = "saveload-textarea";
ta.value = serializeData(port);
container.appendChild(ta);

const loadBtn = document.createElement("button");
loadBtn.addEventListener("click", () => {
  const parsed = parseData(ta.value);
  if (parsed) {
    port.points = parsed;
    port.editMode = "points";  // switch back after loading
    markPortDirty(port);
    renderRack();
    drawOverlay();
  }
});
```

## Checklist

- [ ] `name` is unique across all controller tools
- [ ] `label` is short (shown in a narrow dropdown)
- [ ] `renderPanel(container, port, portIdx, api)` signature is correct
- [ ] Destructure `api.state` and `api.actions` for clean access
- [ ] After modifying `port.points`, call `markPortDirty(port)`
- [ ] After visual changes, call `drawOverlay()` and `updateLinePreviews()`
- [ ] After structural changes, call `renderRack()` to rebuild the sidebar
- [ ] Import paths from `rack/` use `../../../` (3 levels up)
- [ ] Optionally: add a `howto.md` alongside your `tool.js`
