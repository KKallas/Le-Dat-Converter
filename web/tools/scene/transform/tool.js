// ------------------------------------------------------------------ //
// Transform scene tool — offset/pivot/rotate/scale selected points
// ------------------------------------------------------------------ //

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
let _activeControl = "offset"; // which control handle is active for viewport dragging

// ---- Internal helpers ----

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

function _addControlRow(container, labelText, controlKey, fields) {
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
    A.renderRack(); // triggers toolbar.renderPanel() → tool.renderPanel()
    A.drawOverlay();
  });

  // Highlight if this is the active control
  if (_activeControl === controlKey) {
    row.classList.add("active");
  }

  container.appendChild(row);
}

// ---- Scene tool contract ----

const tool = {
  name: "transform",
  label: "Transform",

  init(sharedState, actions) {
    S = sharedState;
    A = actions;
  },

  /** Called by the toolbar host when the user clicks Launch. */
  begin() {
    _beginTransform();
    A.drawOverlay();
  },

  /** Render active controls into the toolbar panel (only called when isActive). */
  renderPanel(container) {
    container.innerHTML = "";

    if (!_transformActive || !_transformState) return;

    // Transform controls
    const s = _transformState;

    _addControlRow(container, "Offset", "offset",
      [{ label: "X", value: Math.round(s.offset.x), key: "offsetX" },
       { label: "Y", value: Math.round(s.offset.y), key: "offsetY" }]);

    _addControlRow(container, "Pivot", "pivot",
      [{ label: "X", value: Math.round(s.pivot.x), key: "pivotX" },
       { label: "Y", value: Math.round(s.pivot.y), key: "pivotY" }]);

    _addControlRow(container, "Rotate", "rotate",
      [{ label: "\u00b0", value: (s.angle * 180 / Math.PI).toFixed(1), key: "angle" }]);

    _addControlRow(container, "Scale", "scale",
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
      A.renderRack(); // triggers toolbar.renderPanel() via host
      A.drawOverlay();
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn-small";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      _cancelTransform();
      A.renderRack();
      A.drawOverlay();
    });

    btns.append(applyBtn, cancelBtn);
    container.appendChild(btns);
  },

  onSelectionChanged() {
    if (_transformActive) {
      _cancelTransform();
    }
  },

  // Viewport integration
  isActive() { return _transformActive; },

  getControlPoints() {
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
  },

  getActiveControl() { return _activeControl; },

  moveControl(x, y) {
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
  },

  getSavedPositions() { return _savedPositions; },

  getTransformState() { return _transformState; },
};

export default tool;
