// ------------------------------------------------------------------ //
// Port / Controller data model — CRUD operations
// ------------------------------------------------------------------ //

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ center: Point, pivot: Point, offset: Point, angle: number, scaleX: number, scaleY: number, baseRadius: number }} TransformState
 * @typedef {{ leds: number, trimStart: number, trimEnd: number, points: Point[], collapsed: boolean, previewCollapsed: boolean, editMode: string, savedPoints: Point[]|null, transformState: TransformState|null }} Port
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
    savedPoints: null,
    transformState: null,
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

// ------------------------------------------------------------------ //
// Transform mode
// ------------------------------------------------------------------ //

export function enterTransformMode(port, mediaW, mediaH) {
  port.savedPoints = port.points.map((p) => ({ x: p.x, y: p.y }));

  // Compute centroid
  let cx = 0, cy = 0;
  for (const p of port.points) { cx += p.x; cy += p.y; }
  cx /= port.points.length;
  cy /= port.points.length;

  // Compute baseRadius from max distance of points to centroid (min 50)
  let maxDist = 0;
  for (const p of port.points) {
    const d = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
    if (d > maxDist) maxDist = d;
  }
  const maxAllowed = Math.min(cx, cy, mediaW - cx, mediaH - cy) * 2;
  const baseRadius = Math.max(50, Math.min(maxDist, maxAllowed));

  port.transformState = {
    center: { x: Math.round(cx), y: Math.round(cy) },
    offset: { x: 0, y: 0 },
    pivot: { x: 0, y: 0 },
    angle: 0,
    scaleX: 1,
    scaleY: 1,
    baseRadius,
  };
  port.editMode = "transform";
}

export function applyTransform(port) {
  if (!port.transformState || !port.savedPoints) return;
  port.points = computeTransformedPoints(port.savedPoints, port.transformState);
  port.editMode = "points";
  port.savedPoints = null;
  port.transformState = null;
}

export function cancelTransform(port) {
  if (port.savedPoints) {
    port.points = port.savedPoints;
  }
  port.editMode = "points";
  port.savedPoints = null;
  port.transformState = null;
}

/** Apply Scale -> Rotate -> Translate. Effective pivot = center + pivot. Offset moves everything. */
export function computeTransformedPoints(savedPoints, transformState) {
  const { center, pivot, offset, angle, scaleX, scaleY } = transformState;
  const epx = center.x + pivot.x;
  const epy = center.y + pivot.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return savedPoints.map((p) => {
    const rx = (p.x - epx) * scaleX;
    const ry = (p.y - epy) * scaleY;
    const rotX = rx * cos - ry * sin;
    const rotY = rx * sin + ry * cos;
    return {
      x: Math.round(rotX + epx + offset.x),
      y: Math.round(rotY + epy + offset.y),
    };
  });
}

/** Get all draggable control points for a port in transform mode. */
export function getTransformControlPoints(port) {
  const s = port.transformState;
  if (!s) return [];
  const sr = s.baseRadius / 2;
  const wx = s.center.x + s.offset.x;
  const wy = s.center.y + s.offset.y;
  const px = wx + s.pivot.x;
  const py = wy + s.pivot.y;

  return [
    { key: "offset", x: wx, y: wy },
    { key: "pivot",  x: px, y: py },
    { key: "rotate", x: px + s.baseRadius * Math.cos(s.angle), y: py + s.baseRadius * Math.sin(s.angle) },
    { key: "scaleX", x: px + sr * s.scaleX, y: py },
    { key: "scaleY", x: px, y: py + sr * s.scaleY },
  ];
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
