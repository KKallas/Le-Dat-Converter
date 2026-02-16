// ------------------------------------------------------------------ //
// Port / Controller data model — CRUD operations
// ------------------------------------------------------------------ //

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ leds: number, trimStart: number, trimEnd: number, points: Point[], collapsed: boolean, previewCollapsed: boolean, editMode: string }} Port
 * @typedef {{ ports: Port[], collapsed: boolean }} Controller
 */

/** Rebuild the flat ports list from controllers. */
export function rebuildPortsList(controllers) {
  return controllers.flatMap((c) => c.ports);
}

/** Create a new empty controller. */
export function createController() {
  return { ports: [], collapsed: false };
}

/** Create a new port with defaults. */
export function createPort(leds = 400, points = null, mediaW = 400, mediaH = 400) {
  if (!points) {
    const cx = Math.round(mediaW / 2);
    const cy = Math.round(mediaH / 2);
    points = [
      { x: cx - 100, y: cy },
      { x: cx + 100, y: cy },
    ];
  }
  return {
    leds,
    points,
    collapsed: false,
    previewCollapsed: true,
    editMode: "points",
    trimStart: 0,
    trimEnd: 0,
  };
}

/** Compute flat index of the first port in controller `ci`. */
export function firstFlatIndex(controllers, ci) {
  let idx = 0;
  for (let i = 0; i < ci; i++) idx += controllers[i].ports.length;
  return idx;
}

/** Add a point to a port. Returns the new point index. */
export function addPointToPort(port) {
  const last = port.points[port.points.length - 1];
  port.points.push({ x: last.x + 30, y: last.y });
  return port.points.length - 1;
}

/** Remove a point from a port. Returns true if removed. */
export function removePointFromPort(port, pointIdx) {
  if (port.points.length <= 2) return false;
  port.points.splice(pointIdx, 1);
  return true;
}

/** Parse tab-separated normalized coordinates back to pixel points. */
export function parseSaveLoadText(text, w, h) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  const points = [];
  for (const line of lines) {
    const parts = line.split(/\t|,|\s+/).map(Number);
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      points.push({
        x: Math.round(parts[0] * w),
        y: Math.round(parts[1] * h),
      });
    }
  }
  return points;
}
