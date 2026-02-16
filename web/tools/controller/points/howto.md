# Points Tool

The default tool for editing polyline control points on each port. Shown in the rack sidebar under each port.

## Usage

- **Click a point** row in the sidebar to select it (clears other selections)
- **Shift+click** a point row to add/remove it from the multi-selection
- **Double-click** on the viewport to select the closest point
- **Shift+double-click** on the viewport to toggle the closest point into/out of the selection
- **Drag** a selected point on the viewport to move it
- **+ Point** button adds a new point at the end of the polyline
- **x** button removes a point (minimum 2 points required)
- Edit X/Y coordinates directly in the number inputs

## Multi-Select

Selected points are shown with a cyan highlight ring on the viewport and a blue border in the sidebar. Multi-selected points can be transformed together using the Transform toolbar below the viewport.

## Plugin Contract

This is a **controller tool** — it operates on a single port's polyline in the rack sidebar.

Controller tools live in `tools/controller/<name>/tool.js` and export:

```javascript
export default {
  name: "points",
  label: "Points",
  renderPanel(container, port, portIdx, api) { ... }
};
```

To register a new controller tool, add it to `tools/controller/registry.js`.

## Tips

- Points are labeled A, B, C... matching the sidebar list
- The polyline follows the order of points — LED sampling goes from first to last
- Use Trim Start / Trim End on the port header to skip LEDs at the beginning or end of the strip
- Use **Select All** on the port or controller header to quickly select all points for batch operations
