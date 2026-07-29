// =====================================================
// MYTHOS OS — Event Bus  (js/core/events.js)
// Lightweight pub/sub. No external dependencies.
// Loaded before all platform code.
//
// API:
//   Events.on(name, handler)    → unsubscribe function
//   Events.off(name, handler)
//   Events.once(name, handler)  → unsubscribe function
//   Events.emit(name, payload)
// =====================================================

var Events = (function () {

  // _listeners[eventName] = [handler, ...]
  var _listeners = {};

  // ── Subscribe ────────────────────────────────────────────────────────
  // Returns an unsubscribe function for convenience.
  function on(eventName, handler) {
    if (typeof eventName !== 'string' || !eventName) {
      console.warn('[Events] on() called with invalid event name:', eventName);
      return function () {};
    }
    if (typeof handler !== 'function') {
      console.warn('[Events] on() called with non-function handler for "' + eventName + '"');
      return function () {};
    }
    if (!_listeners[eventName]) _listeners[eventName] = [];
    _listeners[eventName].push(handler);
    return function () { off(eventName, handler); };
  }

  // ── Unsubscribe ───────────────────────────────────────────────────────
  // Safe: calling off with an unregistered handler is a no-op.
  function off(eventName, handler) {
    if (!_listeners[eventName]) return;
    _listeners[eventName] = _listeners[eventName].filter(function (h) {
      return h !== handler;
    });
    if (_listeners[eventName].length === 0) delete _listeners[eventName];
  }

  // ── Subscribe once ────────────────────────────────────────────────────
  // The handler is automatically removed after the first emit.
  function once(eventName, handler) {
    if (typeof handler !== 'function') {
      console.warn('[Events] once() called with non-function handler for "' + eventName + '"');
      return function () {};
    }
    function wrapper(payload) {
      off(eventName, wrapper);
      handler(payload);
    }
    // Expose the original so external off() calls still work
    wrapper._original = handler;
    return on(eventName, wrapper);
  }

  // ── Emit ──────────────────────────────────────────────────────────────
  // Calls every handler registered for eventName.
  // Handler errors are caught and logged; other handlers still run.
  function emit(eventName, payload) {
    if (typeof eventName !== 'string' || !eventName) {
      console.warn('[Events] emit() called with invalid event name:', eventName);
      return;
    }
    var handlers = (_listeners[eventName] || []).slice(); // snapshot before iteration
    for (var i = 0; i < handlers.length; i++) {
      try {
        handlers[i](payload);
      } catch (e) {
        console.error('[Events] Error in handler for "' + eventName + '":', e);
      }
    }
  }

  // ── Debug helpers (non-enumerable in the return value) ───────────────
  // Not part of the public contract — use only for testing.
  function _listenerCount(eventName) {
    return (_listeners[eventName] || []).length;
  }
  function _eventNames() {
    return Object.keys(_listeners);
  }

  return {
    on:             on,
    off:            off,
    once:           once,
    emit:           emit,
    _listenerCount: _listenerCount,
    _eventNames:    _eventNames
  };

})();
