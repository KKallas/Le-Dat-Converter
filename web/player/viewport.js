// ------------------------------------------------------------------ //
// Viewport — canvas management, pan/zoom, coordinate transforms
// ------------------------------------------------------------------ //

let _canvas = null;
let _wrap = null;   // container element

// Pan/zoom state
let panX = 0;
let panY = 0;
let zoom = 1;

// Media dimensions (set on media load)
let mediaW = 0;
let mediaH = 0;

// Panning state
let _panning = false;
let _panStartX = 0;
let _panStartY = 0;
let _panStartPanX = 0;
let _panStartPanY = 0;

// Callback: called whenever pan/zoom changes so the host can redraw
let _onChange = null;
let _rafPending = false;

/** Optional mode check — when set, built-in scroll/middle-click only work when allowed */
let _getModeAllowed = null;

function _notifyChange() {
  if (!_onChange || _rafPending) return;
  _rafPending = true;
  requestAnimationFrame(() => {
    _rafPending = false;
    if (_onChange) _onChange();
  });
}

export function init(canvas, wrap) {
  _canvas = canvas;
  _wrap = wrap;

  // Zoom with scroll wheel (only when mode allows)
  wrap.addEventListener("wheel", (e) => {
    if (_getModeAllowed && !_getModeAllowed("wheel")) return;
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const oldZoom = zoom;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoom = Math.max(0.1, Math.min(20, zoom * delta));

    // Zoom toward cursor position
    panX = mx - (mx - panX) * (zoom / oldZoom);
    panY = my - (my - panY) * (zoom / oldZoom);
    _notifyChange();
  }, { passive: false });

  // Pan with middle mouse button (only when mode allows)
  wrap.addEventListener("mousedown", (e) => {
    if (e.button === 1) { // middle click
      if (_getModeAllowed && !_getModeAllowed("middle")) return;
      e.preventDefault();
      _panning = true;
      _panStartX = e.clientX;
      _panStartY = e.clientY;
      _panStartPanX = panX;
      _panStartPanY = panY;
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (!_panning) return;
    panX = _panStartPanX + (e.clientX - _panStartX);
    panY = _panStartPanY + (e.clientY - _panStartY);
    _notifyChange();
  });

  window.addEventListener("mouseup", (e) => {
    if (e.button === 1) _panning = false;
  });

  // Touch pinch-zoom
  let _lastTouchDist = 0;
  let _lastTouchCenter = null;

  wrap.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      _lastTouchDist = Math.sqrt(dx * dx + dy * dy);
      _lastTouchCenter = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
    }
  }, { passive: false });

  wrap.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const center = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };

      if (_lastTouchDist > 0) {
        const rect = wrap.getBoundingClientRect();
        const mx = center.x - rect.left;
        const my = center.y - rect.top;

        const oldZoom = zoom;
        zoom = Math.max(0.1, Math.min(20, zoom * (dist / _lastTouchDist)));
        panX = mx - (mx - panX) * (zoom / oldZoom);
        panY = my - (my - panY) * (zoom / oldZoom);

        // Also pan
        if (_lastTouchCenter) {
          panX += center.x - _lastTouchCenter.x;
          panY += center.y - _lastTouchCenter.y;
        }
        _notifyChange();
      }

      _lastTouchDist = dist;
      _lastTouchCenter = center;
    }
  }, { passive: false });

  wrap.addEventListener("touchend", () => {
    _lastTouchDist = 0;
    _lastTouchCenter = null;
  });

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    // Don't intercept when typing in inputs
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (_onStepForward) _onStepForward();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (_onStepBack) _onStepBack();
    } else if (e.key === "0" || e.key === "Home") {
      // Reset view
      e.preventDefault();
      resetView();
      _notifyChange();
    }
  });
}

// ---- Keyboard callbacks ----
let _onStepForward = null;
let _onStepBack = null;

/** Set callbacks for keyboard frame stepping. */
export function setKeyboardCallbacks({ stepForward, stepBack }) {
  _onStepForward = stepForward;
  _onStepBack = stepBack;
}

export function setMediaSize(w, h) {
  mediaW = w;
  mediaH = h;
}

/** Convert screen (DOM) coordinates to media pixel coordinates, accounting for pan/zoom. */
export function screenToMedia(clientX, clientY) {
  const rect = _wrap.getBoundingClientRect();
  // Position within the wrap element
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  // Account for CSS scaling (canvas pixel size vs display size)
  const cssScaleX = _canvas.width / rect.width;
  const cssScaleY = _canvas.height / rect.height;
  // Undo pan/zoom to get media coordinates
  const canvasX = sx * cssScaleX;
  const canvasY = sy * cssScaleY;
  const mx = (canvasX - panX) / zoom;
  const my = (canvasY - panY) / zoom;
  return { x: Math.round(mx), y: Math.round(my) };
}

/** Convert media pixel coordinates to canvas coordinates (for drawing). */
export function mediaToCanvas(mx, my) {
  return {
    x: mx * zoom + panX,
    y: my * zoom + panY,
  };
}

/**
 * Get media coordinates from a pointer event.
 * Replaces the old getMediaCoords function, adding pan/zoom support.
 */
export function getMediaCoords(e) {
  const touch = e.touches?.[0] || e.changedTouches?.[0];
  const clientX = touch ? touch.clientX : e.clientX;
  const clientY = touch ? touch.clientY : e.clientY;
  return screenToMedia(clientX, clientY);
}

/** Check if panning is active (to suppress tool pointer events). */
export function isPanning() {
  return _panning;
}

// ---- Pan/zoom state ----

export function getPan() { return { x: panX, y: panY }; }
export function getZoom() { return zoom; }

export function resetView() {
  panX = 0;
  panY = 0;
  zoom = 1;
}

/** Programmatic pan setter (used by viewer toolbar pan mode). */
export function setPan(x, y) { panX = x; panY = y; _notifyChange(); }

/** Programmatic zoom setter (used by viewer toolbar zoom mode). */
export function setZoom(z) { zoom = Math.max(0.1, Math.min(20, z)); _notifyChange(); }

/**
 * Zoom to fit a bounding box (media coords) within the canvas.
 * @param {{ minX: number, minY: number, maxX: number, maxY: number }} bbox
 * @param {number} canvasW — canvas pixel width
 * @param {number} canvasH — canvas pixel height
 */
export function zoomToFit(bbox, canvasW, canvasH) {
  const bw = bbox.maxX - bbox.minX || 100;
  const bh = bbox.maxY - bbox.minY || 100;
  const pad = 1.2;
  zoom = Math.min(canvasW / (bw * pad), canvasH / (bh * pad));
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  panX = canvasW / 2 - cx * zoom;
  panY = canvasH / 2 - cy * zoom;
  _notifyChange();
}

/** Set a callback invoked whenever pan/zoom changes. */
export function setOnChange(cb) { _onChange = cb; }

/**
 * Set a mode check callback. Called with "wheel" or "middle" —
 * return true to allow built-in scroll-zoom / middle-click-pan.
 */
export function setModeCheck(cb) { _getModeAllowed = cb; }

/**
 * Apply the pan/zoom transform to a canvas context before drawing.
 * Call this, then draw in media coordinates, then call restoreTransform().
 */
export function applyTransform(ctx) {
  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);
}

export function restoreTransform(ctx) {
  ctx.restore();
}
