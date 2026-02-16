# How to Write a Scene Tool

Scene tools operate on the **global multi-point selection** across all ports and controllers. They appear in the **toolbar below the viewport** with a dropdown selector and a Launch button.

**Reference implementation:** `transform/tool.js` (offset/pivot/rotate/scale)

## Quick Start

1. Create `tools/scene/mytool/tool.js`
2. Add one import line to `tools/scene/registry.js`
3. Done — reload the page, pick your tool from the dropdown

## Step 1: Create the tool file

Create `tools/scene/<name>/tool.js`:

```javascript
// tools/scene/mytool/tool.js

let S = null; // shared state — set by init()
let A = null; // actions    — set by init()

let _active = false;

const tool = {
  name: "mytool",     // unique key (used internally)
  label: "My Tool",   // shown in toolbar dropdown

  // ---- Lifecycle ----

  init(sharedState, actions) {
    S = sharedState;
    A = actions;
  },

  begin() {
    // Called when user clicks Launch.
    // Read S.getSelectedPointObjects() to get the selected points.
    // Set _active = true when your operation starts.
    _active = true;
    A.drawOverlay();
  },

  renderPanel(container) {
    // Called by toolbar host when isActive() returns true.
    // Build your controls into `container`.
    // The host already cleared the panel — just append your DOM.
    container.innerHTML = "";
    if (!_active) return;

    // ... build your UI here ...

    // Always include Apply / Cancel buttons:
    const btns = document.createElement("div");
    btns.className = "transform-actions";

    const applyBtn = document.createElement("button");
    applyBtn.className = "btn-small btn-primary";
    applyBtn.textContent = "Apply";
    applyBtn.addEventListener("click", () => {
      // Commit changes, mark affected ports dirty
      _active = false;
      A.renderRack();
      A.drawOverlay();
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn-small";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      // Restore original positions
      _active = false;
      A.renderRack();
      A.drawOverlay();
    });

    btns.append(applyBtn, cancelBtn);
    container.appendChild(btns);
  },

  onSelectionChanged() {
    // Called when the user changes point selection.
    // Typically cancel any in-progress operation.
    if (_active) {
      // restore original state...
      _active = false;
    }
  },

  // ---- Viewport integration (all optional) ----

  isActive() {
    // Return true when your tool has a modal operation in progress.
    // The toolbar host uses this to decide whether to show your
    // renderPanel or its own Launch button.
    return _active;
  },

  getControlPoints() {
    // Return an array of draggable handles for the viewport overlay:
    //   [{ key: "myhandle", x: 100, y: 200 }, ...]
    // Return null if no handles to show.
    return null;
  },

  getActiveControl() {
    // Return the key of the currently active control handle
    // (determines which handle the viewport drag moves).
    return null;
  },

  moveControl(x, y) {
    // Called during viewport drag on a control handle.
    // x, y are in media coordinates (not screen coordinates).
  },

  getSavedPositions() {
    // Return a Map<"portIdx:pointIdx", {x, y}> of original positions
    // for ghost overlay drawing (dashed lines showing where points were).
    // Return null if not applicable.
    return null;
  },
};

export default tool;
```

## Step 2: Register in the registry

Edit `tools/scene/registry.js`:

```javascript
import transform from "./transform/tool.js";
import mytool from "./mytool/tool.js";       // <-- add this

export default [transform, mytool];           // <-- add to array
```

That's it. The toolbar host auto-discovers tools from this array.

## Shared State Reference

The `sharedState` object passed to `init()` provides read access to app state:

| Property | Type | Description |
|---|---|---|
| `activeSelection` | `{port, point}\|null` | Currently focused point (for keyboard nav) |
| `selectedPoints` | `Set<string>` | Multi-selected points as `"portIdx:pointIdx"` keys |
| `ports` | `Port[]` | Flat array of all ports across all controllers |
| `mediaW` | `number` | Media width in pixels |
| `mediaH` | `number` | Media height in pixels |
| `isPointSelected(pi, pti)` | `function` | Check if a specific point is in the selection |
| `getSelectedPointObjects()` | `function` | Returns `[{portIdx, pointIdx, point}]` for all selected points |

## Actions Reference

The `actions` object passed to `init()` provides callbacks for mutations and side effects:

| Action | Signature | Description |
|---|---|---|
| `markPortDirty(port)` | `(Port) => void` | Mark a port's preview as needing re-render |
| `markAllPortsDirty()` | `() => void` | Mark all ports dirty |
| `drawOverlay()` | `() => void` | Redraw the viewport overlay (polylines, handles, etc.) |
| `updateLinePreviews()` | `() => void` | Redraw the per-port line preview strips |
| `renderRack()` | `() => void` | Re-render the rack sidebar + toolbar panel |

## Re-render Pattern

When your tool modifies state and needs a UI update, call actions in this order:

```javascript
// After modifying point positions:
A.drawOverlay();        // updates canvas
A.updateLinePreviews(); // updates line strips

// After Apply/Cancel (tool deactivates):
A.renderRack();         // re-renders sidebar + toolbar (shows Launch button again)
A.drawOverlay();        // cleans up overlay

// To re-render just your own panel (e.g. highlight a different control):
A.renderRack();         // triggers toolbar.renderPanel() → your renderPanel()
A.drawOverlay();
```

**Important:** Never call `toolbar.renderPanel()` directly from within a tool. Always use `A.renderRack()` which triggers the full render chain.

## Viewport Integration

If your tool needs draggable handles on the viewport overlay:

1. **`getControlPoints()`** — Return `[{key, x, y}]` array. The viewport draws these as handles and uses them for hit-testing on click/drag.

2. **`getActiveControl()`** — Return the `key` string of the handle that should respond to drag. The viewport highlights this handle differently.

3. **`moveControl(x, y)`** — Called on every pointer-move while the user drags a handle. `x, y` are in media pixel coordinates. Update your internal state and call `_applyTransformToPoints()` or equivalent.

4. **`getSavedPositions()`** — Return a `Map<"pi:pti", {x, y}>` of original (pre-transform) positions. The viewport draws these as dashed ghost polylines so the user can see the before/after.

If your tool doesn't need viewport handles (e.g. it only uses the panel UI), return `null`/`false` from all viewport methods.

## CSS Classes Available

| Class | Element | Description |
|---|---|---|
| `point-row` | `div` | Row container (matches rack sidebar point rows) |
| `point-label` | `span` | Label text within a row |
| `coord-input` | `input` | Number input for coordinates |
| `transform-actions` | `div` | Button group container |
| `btn-small` | `button` | Small button |
| `btn-small btn-primary` | `button` | Small primary (blue) button |
| `btn-danger` | `button` | Danger (red) button |
| `active` | added to row | Highlights a row as the active control |

## Checklist

- [ ] `name` is unique across all scene tools
- [ ] `label` is short and descriptive (shown in dropdown)
- [ ] `init()` stores `sharedState` and `actions` for later use
- [ ] `begin()` reads from `S.getSelectedPointObjects()` and handles empty selection
- [ ] `renderPanel()` builds controls only when active, always includes Apply/Cancel
- [ ] `onSelectionChanged()` cancels any in-progress operation
- [ ] `isActive()` returns correct boolean
- [ ] Apply calls `A.renderRack()` + `A.drawOverlay()` after deactivating
- [ ] Cancel restores original positions before deactivating
- [ ] Optionally: add a `howto.md` alongside your `tool.js`
