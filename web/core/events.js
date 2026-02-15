// ------------------------------------------------------------------ //
// Simple event bus for cross-module communication
// ------------------------------------------------------------------ //

/** @type {Map<string, Set<Function>>} */
const _listeners = new Map();

export const bus = {
  /**
   * Subscribe to an event. Returns an unsubscribe function.
   * @param {string} event
   * @param {Function} callback
   */
  on(event, callback) {
    if (!_listeners.has(event)) _listeners.set(event, new Set());
    _listeners.get(event).add(callback);
    return () => {
      const s = _listeners.get(event);
      if (s) { s.delete(callback); if (s.size === 0) _listeners.delete(event); }
    };
  },

  /**
   * Subscribe to an event once — auto-removes after first call.
   */
  once(event, callback) {
    const unsub = bus.on(event, (...args) => {
      unsub();
      callback(...args);
    });
    return unsub;
  },

  /**
   * Emit an event with optional data.
   * @param {string} event
   * @param {*} [data]
   */
  emit(event, data) {
    const s = _listeners.get(event);
    if (s) for (const cb of s) cb(data);
  },

  /**
   * Remove a specific listener.
   */
  off(event, callback) {
    const s = _listeners.get(event);
    if (s) { s.delete(callback); if (s.size === 0) _listeners.delete(event); }
  },
};
