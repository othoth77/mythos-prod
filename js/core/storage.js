// =====================================================
// MYTHOS OS — Core Storage Layer
// Lowest-risk localStorage helpers: read, write, cache.
// No sync queue. No server calls. No business logic.
// Loaded before app.js and all modules.
// =====================================================

// ── In-memory fallback cache ───────────────────────────────────────────
// When localStorage quota is exceeded, _safeSet keeps the value here so
// the current session still works. _storeGet checks this cache on any
// localStorage read failure so data is never silently lost mid-session.
var _memCache = {};

// ── Safe localStorage read with JSON parse ─────────────────────────────
// Returns the stored value, the _memCache copy, or the supplied default.
// Never throws — all JSON and storage errors are silently absorbed.
function _storeGet(key, def) {
  try {
    var raw = localStorage.getItem(key);
    if (raw !== null) return JSON.parse(raw);
  } catch(e) {}
  if (Object.prototype.hasOwnProperty.call(_memCache, key)) return _memCache[key];
  try { return JSON.parse(def); } catch(e) { return def; }
}

// ── Safe localStorage write ────────────────────────────────────────────
// Writes to _memCache first (always succeeds), then to localStorage.
// Returns true on success, false if localStorage quota is exceeded.
// Never throws — quota errors are caught and logged as warnings.
function _safeSet(key, value) {
  _memCache[key] = value;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch(e) {
    console.warn('[Mythos Store] Quota localStorage dépassé pour "' + key
      + '" — conservé en mémoire pour cette session (' + e.message + ').');
    return false;
  }
}

// ── Storage existence check ────────────────────────────────────────────
// Returns true if the key exists in localStorage or _memCache.
function _storeHas(key) {
  try { if (localStorage.getItem(key) !== null) return true; } catch(e) {}
  return Object.prototype.hasOwnProperty.call(_memCache, key);
}

// ── Safe localStorage remove ───────────────────────────────────────────
function _storeRemove(key) {
  delete _memCache[key];
  try { localStorage.removeItem(key); } catch(e) {}
}
