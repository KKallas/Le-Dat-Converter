# Transform Tool

Translate, rotate, and scale selected points across any combination of ports and controllers.

The Transform toolbar lives below the viewport and operates on the current multi-point selection.

## Selecting Points

- **Click** a point row in the rack sidebar to select it
- **Shift+click** a point row to toggle it into/out of the selection
- **Double-click** on the viewport to select the closest point
- **Shift+double-click** on the viewport to toggle the closest point
- **Select All** button on a port header selects all points in that port
- **Select All** button on a controller header selects all points across all its ports

Selected points are highlighted with a cyan ring on the viewport and a blue border in the sidebar.

## Controls

Once points are selected, the toolbar shows a **Launch** button. After clicking it:

- **Offset** (square handle) — moves all selected points together. This is the primary move control.
- **Pivot** (diamond/crosshair) — sets the center of rotation and scaling, relative to Offset.
- **Rotate** (circle) — drag to rotate around the pivot. Value is in degrees.
- **Scale X / Y** (circles) — drag to scale horizontally or vertically around the pivot.

Click the control name rows in the toolbar to switch which handle is active for viewport dragging.

## Workflow

1. Select points using any combination of the methods above
2. Click **Launch** in the toolbar below the viewport
3. Drag the control handles on the viewport, or type values in the toolbar inputs
4. Click **Apply** to commit the transform, or **Cancel** to revert

## Plugin Contract

This is a **scene tool** — it operates on the global point selection across all ports/controllers.

Scene tools live in `tools/scene/<name>/tool.js` and export:

```javascript
export default {
  name: "transform",
  label: "Transform",
  init(sharedState, actions),
  begin(),
  renderPanel(container),
  onSelectionChanged(),
  isActive(),
  getControlPoints(),
  getActiveControl(),
  moveControl(x, y),
  getSavedPositions(),
};
```

To register a new scene tool, add it to `tools/scene/registry.js`.

## Tips

- The original polyline positions are shown as dashed ghost lines for reference
- Transform works across multiple ports simultaneously
- Changing the selection while a transform is active will cancel the transform
- Offset moves the entire group; Pivot only adjusts where rotation/scale happens
