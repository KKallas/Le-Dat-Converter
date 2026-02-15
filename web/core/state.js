// ------------------------------------------------------------------ //
// Central state store with path-based pub/sub
// ------------------------------------------------------------------ //

const _data = {
  media: { type: "", width: 0, height: 0, ready: false, image: null, fps: 0 },
  frames: [],           // Blob[] (JPEG)
  controllers: [],      // Controller[]
  ports: [],            // flat derived list (rebuilt from controllers)
  selection: {
    points: [],         // [{ portIdx, pointIdx }, ...] — multi-select
    activeTool: "points",
  },
  playback: { currentFrame: 0, isPlaying: false, inPoint: 0, outPoint: 0 },
  settings: { portsPerController: 8, maxResolution: 1280, frameOffset: 0, frameLength: 2000 },
  export: { templateHeader: null, templateFileName: "", includeTxt: false },
  viewport: { panX: 0, panY: 0, zoom: 1 },

  // Internal UI state
  ui: { outputCollapsed: false, exporting: false },
};

/** @type {Map<string, Set<Function>>} path → set of callbacks */
const _subs = new Map();

let _batching = false;
/** @type {Set<string>} paths changed during batch */
const _batchedPaths = new Set();

/**
 * Resolve a dot-separated path like "media.width" to { obj, key }.
 * Returns null if any intermediate segment is missing.
 */
function _resolve(path) {
  const parts = path.split(".");
  let obj = _data;
  for (let i = 0; i < parts.length - 1; i++) {
    obj = obj[parts[i]];
    if (obj == null) return null;
  }
  return { obj, key: parts[parts.length - 1] };
}

function _notify(path) {
  if (_batching) { _batchedPaths.add(path); return; }
  _fireSubscribers(path);
}

function _fireSubscribers(path) {
  // Fire exact match
  const exact = _subs.get(path);
  if (exact) for (const cb of exact) cb();

  // Fire parent path watchers (e.g., "media" fires when "media.width" changes)
  const dot = path.lastIndexOf(".");
  if (dot > 0) {
    const parent = path.substring(0, dot);
    _fireSubscribers(parent);
  }
}

export const state = {
  /**
   * Get a value by dot path. Returns the raw reference (not a copy).
   * @param {string} [path] - optional; omit for full state
   */
  get(path) {
    if (!path) return _data;
    const r = _resolve(path);
    return r ? r.obj[r.key] : undefined;
  },

  /**
   * Set a value by dot path and notify subscribers.
   */
  set(path, value) {
    const r = _resolve(path);
    if (!r) return;
    const old = r.obj[r.key];
    if (old === value) return;
    r.obj[r.key] = value;
    _notify(path);
  },

  /**
   * Batch multiple sets — subscribers are notified once at the end.
   */
  batch(fn) {
    _batching = true;
    try { fn(); } finally {
      _batching = false;
      for (const path of _batchedPaths) _fireSubscribers(path);
      _batchedPaths.clear();
    }
  },

  /**
   * Subscribe to changes on a path. Returns an unsubscribe function.
   * The callback receives no arguments — call state.get(path) inside it.
   */
  subscribe(path, cb) {
    if (!_subs.has(path)) _subs.set(path, new Set());
    _subs.get(path).add(cb);
    return () => {
      const s = _subs.get(path);
      if (s) { s.delete(cb); if (s.size === 0) _subs.delete(path); }
    };
  },

  /** Direct access to the data object (for bulk restore during scene load) */
  _data,
};
