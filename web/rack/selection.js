// ------------------------------------------------------------------ //
// Multi-point selection model
// ------------------------------------------------------------------ //

import { state } from "../core/state.js";
import { bus } from "../core/events.js";

/** Select a single point (clears previous selection). */
export function selectPoint(portIdx, pointIdx) {
  state.set("selection.points", [{ portIdx, pointIdx }]);
  bus.emit("selection:changed");
}

/** Select a single transform control (clears previous selection). */
export function selectControl(portIdx, controlKey) {
  state.set("selection.points", [{ portIdx, control: controlKey }]);
  bus.emit("selection:changed");
}

/** Toggle a point in/out of the selection (for Shift+Click). */
export function togglePoint(portIdx, pointIdx) {
  const current = state.get("selection.points") || [];
  const idx = current.findIndex((s) => s.portIdx === portIdx && s.pointIdx === pointIdx);
  if (idx >= 0) {
    const next = [...current];
    next.splice(idx, 1);
    state.set("selection.points", next);
  } else {
    state.set("selection.points", [...current, { portIdx, pointIdx }]);
  }
  bus.emit("selection:changed");
}

/** Select all points on a port. */
export function selectAllOnPort(portIdx, pointCount) {
  const points = [];
  for (let i = 0; i < pointCount; i++) {
    points.push({ portIdx, pointIdx: i });
  }
  state.set("selection.points", points);
  bus.emit("selection:changed");
}

/** Clear selection entirely. */
export function clearSelection() {
  state.set("selection.points", []);
  bus.emit("selection:changed");
}

/** Get the current selection array. */
export function getSelection() {
  return state.get("selection.points") || [];
}

/** Check if a specific point is selected. */
export function isPointSelected(portIdx, pointIdx) {
  const sel = state.get("selection.points") || [];
  return sel.some((s) => s.portIdx === portIdx && s.pointIdx === pointIdx);
}

/** Check if a specific control is selected. */
export function isControlSelected(portIdx, controlKey) {
  const sel = state.get("selection.points") || [];
  return sel.some((s) => s.portIdx === portIdx && s.control === controlKey);
}

/**
 * Convert old-style activeSelection to new multi-select format.
 * Used as a bridge during migration.
 */
export function fromLegacySelection(activeSelection) {
  if (!activeSelection) return [];
  if ("control" in activeSelection) {
    return [{ portIdx: activeSelection.port, control: activeSelection.control }];
  }
  return [{ portIdx: activeSelection.port, pointIdx: activeSelection.point }];
}

/**
 * Convert new multi-select format back to old-style activeSelection.
 * Used as a bridge during migration.
 */
export function toLegacySelection(points) {
  if (!points || points.length === 0) return null;
  const first = points[0];
  if ("control" in first) {
    return { port: first.portIdx, control: first.control };
  }
  return { port: first.portIdx, point: first.pointIdx };
}
