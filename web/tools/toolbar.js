// ------------------------------------------------------------------ //
// Toolbar — Transform tool operating on selected points
// ------------------------------------------------------------------ //

let _container = null;
let _panel = null;

/**
 * Shared state interface — the host wires getters/setters.
 * @type {{ activeSelection, selectedPoints, ports, mediaW, mediaH,
 *          isPointSelected, getSelectedPointObjects }}
 */
let S = null;

/**
 * Actions — callbacks into the host for mutations and side effects.
 * @type {{ markPortDirty, markAllPortsDirty, drawOverlay, updateLinePreviews, renderRack }}
 */
let A = null;

// Transform state (global, operates on selectedPoints)
let _transformActive = false;
/** @type {Map<string, {x:number, y:number}>} saved original positions keyed by "portIdx:pointIdx" */
const _savedPositions = new Map();
let _transformState = null; // { center, pivot, offset, angle, scaleX, scaleY, baseRadius }

// ---- Public API ----

export function isTransformActive() { return _transformActive; }
export function getTransformState() { return _transformState; }
export function getSavedPositions() { return _savedPositions; }

/**
 * Initialize the toolbar UI.
 * @param {HTMLElement} container - mount point (#toolbar)
 * @param {object} sharedState - state accessors
 * @param {object} actions - action callbacks
 */
export function init(container, sharedState, actions) {
  _container = container;
  S = sharedState;
  A = actions;

  const bar = document.createElement("div");
  bar.className = "toolbar-bar";

  const label = document.createElement("label");
  label.className = "toolbar-label";
  label.textContent = "Transform";

  bar.appendChild(label);
  _container.appendChild(bar);

  _panel = document.createElement("div");
  _panel.className = "toolbar-panel";
  _container.appendChild(_panel);

  renderPanel();
}

// ---- Panel rendering ----

/** Re-render the transform panel. */
export function renderPanel() {
  if (!_panel) return;
  _panel.innerHTML = "";

  const count = S.selectedPoints.size;

  if (count === 0) {
    const hint = document.createElement("div");
    hint.className = "toolbar-hint";
    hint.textContent = "Select points to transform (Shift+click for multi-select)";
    _panel.appendChild(hint);
    return;
  }

  // Selected point count
  const info = document.createElement("div");
  info.style.cssText = "font-size:0.8rem;color:#888;margin-bottom:6px";
  info.textContent = `${count} point${count !== 1 ? "s" : ""} selected`;
  _panel.appendChild(info);

  if (!_transformActive) {
    // Begin Transform button
    const beginBtn = document.createElement("button");
    beginBtn.className = "btn-primary";
    beginBtn.style.cssText = "width:100%;margin-bottom:4px";
    beginBtn.textContent = "Begin Transform";
    beginBtn.addEventListener("click", () => {
      _beginTransform();
      renderPanel();
      A.drawOverlay();
    });
    _panel.appendChild(beginBtn);
    return;
  }

  // Transform controls
  const s = _transformState;

  _addControlRow("Offset", "offset",
    [{ label: "X", value: Math.round(s.offset.x), key: "offsetX" },
     { label: "Y", value: Math.round(s.offset.y), key: "offsetY" }]);

  _addControlRow("Pivot", "pivot",
    [{ label: "X", value: Math.round(s.pivot.x), key: "pivotX" },
     { label: "Y", value: Math.round(s.pivot.y), key: "pivotY" }]);

  _addControlRow("Rotate", "rotate",
    [{ label: "\u00b0", value: (s.angle * 180 / Math.PI).toFixed(1), key: "angle" }]);

  _addControlRow("Scale", "scale",
    [{ label: "X", value: s.scaleX.toFixed(2), key: "scaleX" },
     { label: "Y", value: s.scaleY.toFixed(2), key: "scaleY" }]);

  // Apply / Cancel buttons
  const btns = document.createElement("div");
  btns.className = "transform-actions";

  const applyBtn = document.createElement("button");
  applyBtn.className = "btn-small btn-primary";
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", () => {
    _applyTransform();
    renderPanel();
    A.renderRack();
    A.drawOverlay();
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn-small";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    _cancelTransform();
    renderPanel();
    A.renderRack();
    A.drawOverlay();
  });

  btns.append(applyBtn, cancelBtn);
  _panel.appendChild(btns);
}

function _addControlRow(labelText, controlKey, fields) {
  const row = document.createElement("div");
  row.className = "point-row";
  row.style.cursor = "default";

  const lbl = document.createElement("span");
  lbl.className = "point-label";
  lbl.textContent = labelText;
  row.appendChild(lbl);

  for (const field of fields) {
    const fl = document.createElement("span");
    fl.style.cssText = "font-size:0.75rem;color:#888;margin-left:4px";
    fl.textContent = field.label;

    const inp = document.createElement("input");
    inp.type = "number";
    inp.className = "coord-input";
    inp.value = field.value;
    inp.step = field.key === "angle" ? "1" : field.key.startsWith("scale") ? "0.01" : "1";
    inp.addEventListener("change", () => {
      _onControlChange(field.key, parseFloat(inp.value) || 0);
    });

    row.append(fl, inp);
  }

  // Make the row selectable for dragging on viewport
  row.addEventListener("click", () => {
    _activeControl = controlKey;
    renderPanel();
    A.drawOverlay();
  });

  // Highlight if this is the active control
  if (_activeControl === controlKey) {
    row.classList.add("active");
  }

  _panel.appendChild(row);
}

let _activeControl = "offset"; // which control handle is active for viewport dragging

export function getActiveControl() { return _activeControl; }

function _onControlChange(key, value) {
  if (!_transformState) return;
  const s = _transformState;

  if (key === "offsetX") s.offset.x = value;
  else if (key === "offsetY") s.offset.y = value;
  else if (key === "pivotX") s.pivot.x = value;
  else if (key === "pivotY") s.pivot.y = value;
  else if (key === "angle") s.angle = value * Math.PI / 180;
  else if (key === "scaleX") s.scaleX = value;
  else if (key === "scaleY") s.scaleY = value;

  _applyTransformToPoints();
  A.drawOverlay();
  A.updateLinePreviews();
}

// ---- Selection change notification ----

export function onSelectionChanged() {
  // If transform is active and selection changed, cancel it
  if (_transformActive) {
    _cancelTransform();
  }
  renderPanel();
}

// ---- Transform logic ----

function _beginTransform() {
  const pts = S.getSelectedPointObjects();
  if (pts.length === 0) return;

  _savedPositions.clear();
  let cx = 0, cy = 0;
  for (const p of pts) {
    _savedPositions.set(`${p.portIdx}:${p.pointIdx}`, { x: p.point.x, y: p.point.y });
    cx += p.point.x;
    cy += p.point.y;
  }
  cx /= pts.length;
  cy /= pts.length;

  const maxDist = Math.max(50, ...pts.map(p => Math.hypot(p.point.x - cx, p.point.y - cy)));

  _transformState = {
    center: { x: cx, y: cy },
    pivot: { x: 0, y: 0 },
    offset: { x: 0, y: 0 },
    angle: 0,
    scaleX: 1,
    scaleY: 1,
    baseRadius: maxDist,
  };
  _activeControl = "offset";
  _transformActive = true;
}

/** Apply current transform state to all saved points */
function _applyTransformToPoints() {
  const s = _transformState;
  if (!s) return;

  for (const [key, saved] of _savedPositions) {
    const [pi, pti] = key.split(":").map(Number);
    const port = S.ports[pi];
    if (!port || !port.points[pti]) continue;

    // Transform relative to center
    let dx = saved.x - s.center.x;
    let dy = saved.y - s.center.y;

    // Scale
    dx *= s.scaleX;
    dy *= s.scaleY;

    // Rotate
    const cos = Math.cos(s.angle);
    const sin = Math.sin(s.angle);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;

    // Translate: center + offset + pivot
    port.points[pti].x = s.center.x + s.offset.x + s.pivot.x + rx;
    port.points[pti].y = s.center.y + s.offset.y + s.pivot.y + ry;
  }
}

function _applyTransform() {
  // Keep transformed positions, mark affected ports dirty
  const affectedPorts = new Set();
  for (const key of _savedPositions.keys()) {
    const pi = parseInt(key.split(":")[0]);
    if (S.ports[pi]) affectedPorts.add(S.ports[pi]);
  }
  for (const port of affectedPorts) {
    A.markPortDirty(port);
  }

  _savedPositions.clear();
  _transformState = null;
  _transformActive = false;
}

function _cancelTransform() {
  // Restore original positions
  for (const [key, saved] of _savedPositions) {
    const [pi, pti] = key.split(":").map(Number);
    const port = S.ports[pi];
    if (!port || !port.points[pti]) continue;
    port.points[pti].x = saved.x;
    port.points[pti].y = saved.y;
  }

  _savedPositions.clear();
  _transformState = null;
  _transformActive = false;
}

// ---- Viewport interaction: move transform controls ----

/**
 * Called by the host when dragging a transform control on the viewport.
 * @param {number} x - media x coordinate
 * @param {number} y - media y coordinate
 */
export function moveControl(x, y) {
  if (!_transformActive || !_transformState) return;
  const s = _transformState;

  const px = s.center.x + s.offset.x + s.pivot.x;
  const py = s.center.y + s.offset.y + s.pivot.y;

  if (_activeControl === "offset") {
    s.offset.x = x - s.center.x;
    s.offset.y = y - s.center.y;
  } else if (_activeControl === "pivot") {
    s.pivot.x = x - s.center.x - s.offset.x;
    s.pivot.y = y - s.center.y - s.offset.y;
  } else if (_activeControl === "rotate") {
    s.angle = Math.atan2(y - py, x - px);
  } else if (_activeControl === "scale") {
    s.scaleX = (x - px) / (s.baseRadius / 2);
    s.scaleY = (y - py) / (s.baseRadius / 2);
  }

  _applyTransformToPoints();
}

/**
 * Get the positions of transform control handles for viewport drawing.
 * @returns {Array<{key: string, x: number, y: number}>|null}
 */
export function getControlPoints() {
  if (!_transformActive || !_transformState) return null;
  const s = _transformState;

  const cx = s.center.x + s.offset.x;
  const cy = s.center.y + s.offset.y;
  const px = cx + s.pivot.x;
  const py = cy + s.pivot.y;
  const r = s.baseRadius / 2;

  return [
    { key: "offset", x: cx, y: cy },
    { key: "pivot", x: px, y: py },
    { key: "rotate", x: px + r * Math.cos(s.angle), y: py + r * Math.sin(s.angle) },
    { key: "scale", x: px + r * s.scaleX, y: py + r * s.scaleY },
  ];
}
