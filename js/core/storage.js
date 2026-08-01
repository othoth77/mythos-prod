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

// ══════════════════════════════════════════════════════════════════════
// Pending Write Pipeline — moved from app.js
// Provides: _localMeta, _metaUpdate, _pendingKeys, _pendingAdd,
// _pendingRemove, _pendingClear, _buildPendingBulk, _flushPending,
// _flushPendingBeacon, _pullFromServerNow, _autoBackupTimer,
// _triggerAutoBackup, _pushCollection, _storeSave
// Depends on: _safeSet, _storeGet (defined above in this file)
// ══════════════════════════════════════════════════════════════════════
// ── Métadonnées locales (timestamps par collection) ───────────────────
var _localMeta = (function() {
  try { return JSON.parse(localStorage.getItem('_mp_sync_meta') || '{}'); } catch(e) { return {}; }
})();
function _metaUpdate(key, now) {
  _localMeta[key] = { updatedAt: now, ts: new Date(now).getTime() };
  try { localStorage.setItem('_mp_sync_meta', JSON.stringify(_localMeta)); } catch(e) {}
}

// ── Queue persistante : clés non encore confirmées par le serveur ─────
// Survit aux rechargements, coupures réseau, fermetures forcées.
var _pendingKeys = (function() {
  try { return new Set(JSON.parse(localStorage.getItem('_mp_pending_keys') || '[]')); } catch(e) { return new Set(); }
})();
function _pendingAdd(key) {
  _pendingKeys.add(key);
  try { localStorage.setItem('_mp_pending_keys', JSON.stringify(Array.from(_pendingKeys))); } catch(e) {}
}
function _pendingRemove(key) {
  _pendingKeys.delete(key);
  try { localStorage.setItem('_mp_pending_keys', JSON.stringify(Array.from(_pendingKeys))); } catch(e) {}
}
function _pendingClear() {
  _pendingKeys.clear();
  try { localStorage.removeItem('_mp_pending_keys'); } catch(e) {}
}

// ── Construire le payload bulk depuis la queue ─────────────────────────
function _buildPendingBulk() {
  var bulk = {};
  var now  = new Date().toISOString();
  _pendingKeys.forEach(function(k) {
    try {
      var v = localStorage.getItem(k);
      if (v) { bulk[k] = JSON.parse(v); _metaUpdate(k, now); }
    } catch(e) {}
  });
  return { bulk: bulk, updatedAt: now };
}

// ── Vider la queue vers le serveur (fetch classique) ─────────────────
function _flushPending() {
  if (_pendingKeys.size === 0 || navigator.onLine === false) return;
  var payload = _buildPendingBulk();
  if (Object.keys(payload.bulk).length === 0) { _pendingClear(); return; }
  fetch('api.php', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ __bulk__: payload.bulk, updatedAt: payload.updatedAt })
  })
  .then(function(r) { return r.json(); })
  .then(function(res) {
    if (res && res.ok) {
      _pendingClear();
      console.log('[Mythos Sync] ✓ Queue vidée — ' + Object.keys(payload.bulk).length + ' collection(s)');
    }
  })
  .catch(function() { /* réseau indisponible — réessai au prochain événement */ });
}

// ── Vider la queue via sendBeacon (fermeture/arrière-plan) ───────────
// sendBeacon est conçu pour envoyer des données même quand la page se ferme.
function _flushPendingBeacon() {
  if (_pendingKeys.size === 0) return;
  var payload = _buildPendingBulk();
  if (Object.keys(payload.bulk).length === 0) return;
  var body = JSON.stringify({ __bulk__: payload.bulk, updatedAt: payload.updatedAt });
  if (navigator.sendBeacon) {
    try {
      navigator.sendBeacon('api.php', new Blob([body], { type: 'application/json' }));
    } catch(e) {
      // Fallback si sendBeacon échoue (iOS ancien)
      try { fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function(){}); } catch(e2) {}
    }
  } else {
    try { fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function(){}); } catch(e) {}
  }
}

// ── Événements de sauvegarde d'urgence ────────────────────────────────
// 1. Page masquée (app en arrière-plan, écran verrouillé, changement d'onglet)
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'hidden') {
    _flushPendingBeacon();
  } else if (document.visibilityState === 'visible') {
    // L'app redevient visible (retour d'un autre onglet/app/écran verrouillé)
    // → re-sync immédiat pour récupérer ce qui a été ajouté depuis un autre appareil.
    _pullFromServerNow();
  }
});
// 2. Page fermée / navigation vers une autre page
window.addEventListener('pagehide', function() { _flushPendingBeacon(); }, { capture: true });
// 2b. Fenêtre/onglet qui reprend le focus (desktop) → même logique que "visible"
window.addEventListener('focus', function() { _pullFromServerNow(); });
// 3. Retour réseau → sync normal
window.addEventListener('online', function() {
  console.log('[Mythos Sync] 📶 Réseau restauré — sync en cours…');
  setTimeout(_flushPending, 1500);
  _pullFromServerNow();
});
// 4. Heartbeat toutes les 30s — vide la queue si des données attendent
setInterval(function() {
  if (_pendingKeys.size > 0) _flushPending();
}, 30000);

// ── Pull immédiat depuis le serveur (focus/visible/réseau) ────────────
// Anti-rafale : on évite de relancer un sync si un autre vient de tourner
// il y a moins de 8s (visibilitychange + focus se déclenchent souvent ensemble).
var _lastPullTs = 0;
function _pullFromServerNow() {
  var now = Date.now();
  if (now - _lastPullTs < 8000) return;
  if (typeof AUTH !== 'undefined' && AUTH && typeof AUTH.isSessionValid === 'function' && !AUTH.isSessionValid()) return;
  if (navigator.onLine === false) return;
  if (typeof syncFromServer !== 'function') return;
  _lastPullTs = now;
  syncFromServer(function() {
    try { if (typeof updateDashboardStats === 'function') updateDashboardStats(); } catch(e) {}
    try { if (typeof renderTachesDashboard === 'function') renderTachesDashboard(); } catch(e) {}
    try { if (typeof renderTachePage === 'function') renderTachePage(); } catch(e) {}
  }, true);
}

// ── AUTO-BACKUP SERVEUR (debounce 3s après la dernière action) ───────
var _autoBackupTimer = null;
function _triggerAutoBackup(label) {
  clearTimeout(_autoBackupTimer);
  _autoBackupTimer = setTimeout(function() {
    try {
      var snapshot = {};
      var keys = typeof RESTORE_KEY_MAP !== 'undefined' ? Object.values(RESTORE_KEY_MAP) : [];
      keys.forEach(function(k) {
        try { var v = localStorage.getItem(k); if (v) snapshot[k] = JSON.parse(v); } catch(e) {}
      });
      if (Object.keys(snapshot).length === 0) return;
      fetch('api.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ __auto_backup__: snapshot, label: 'auto_' + (label || 'save') })
      }).catch(function() {});
    } catch(e) {}
  }, 5 * 60 * 1000); // 5 minutes — évite de remplir le disque
}

// ── Envoi serveur d'une collection, en plusieurs morceaux si trop volumineuse ──
// Évite l'erreur 413 (Request Entity Too Large) qui survenait dès qu'une grosse
// collection (ex. répertoire de contacts à 1000+ entrées) dépassait la taille de
// requête acceptée par le serveur. Le serveur réassemble les morceaux (voir api.php,
// bloc __chunk__) une fois tous reçus.
function _pushCollection(key, value, updatedAt, onDone) {
  var json;
  try { json = JSON.stringify(value); } catch(e) { json = ''; }
  var CHUNK_THRESHOLD = 400000; // ~400 Ko : marge confortable sous les limites serveur usuelles
  if (Array.isArray(value) && value.length > 1 && json.length > CHUNK_THRESHOLD) {
    var nbChunks  = Math.max(2, Math.ceil(json.length / CHUNK_THRESHOLD));
    var chunkSize = Math.max(1, Math.ceil(value.length / nbChunks));
    var chunks = [];
    for (var i = 0; i < value.length; i += chunkSize) chunks.push(value.slice(i, i + chunkSize));
    var total = chunks.length;
    (function sendChunk(idx) {
      fetch('api.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ __chunk__: true, key: key, chunk: chunks[idx], chunkIndex: idx, totalChunks: total, updatedAt: updatedAt })
      })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (!res || res.ok === false) { if (onDone) onDone(false); return; }
        if (idx + 1 < total) sendChunk(idx + 1);
        else if (onDone) onDone(true);
      })
      .catch(function() { if (onDone) onDone(false); });
    })(0);
  } else {
    fetch('api.php', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ key: key, value: value, updatedAt: updatedAt })
    })
    .then(function(r) { return r.json(); })
    .then(function(res) { if (onDone) onDone(res && res.ok !== false); })
    .catch(function() { if (onDone) onDone(false); });
  }
}

// ── Écriture : local immédiat + queue + sync serveur horodaté ────────
function _storeSave(key, data) {
  var now = new Date().toISOString();
  // 1. Cache local immédiat (mémoire toujours garantie ; localStorage si la place le permet)
  _safeSet(key, data);
  // 2. Timestamp local
  _metaUpdate(key, now);
  // 3. Marquer comme en attente de sync serveur
  _pendingAdd(key);
  // 4. Tenter le sync serveur immédiatement
  // Règle : l'appareil qui écrit activement gagne toujours.
  // Les conflits inter-appareils sont résolus uniquement au démarrage (syncFromServer).
  _pushCollection(key, data, now, function(ok) {
    if (ok) _pendingRemove(key); // serveur a confirmé → retirer de la queue
    // sinon : la clé reste dans _pendingKeys, réessayée par le heartbeat/online/fermeture
  });
  // 5. Backup complet 3s après la dernière action
  _triggerAutoBackup(key.replace('mp_', ''));
}
