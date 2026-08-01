// MYTHOS PROD — SYNC ENGINE v5
// Règle absolue : merge par ID pour les tableaux. Jamais de remplacement.
// Chaque appareil pousse ce qu'il a. Le serveur accumule tout.
// ══════════════════════════════════════════════════════════════════════

// ── Fusion par ID — fonctionne même sans timestamps ───────────────────
function _mergeCollections(local, server) {
  var la = Array.isArray(local)  ? local  : [];
  var sa = Array.isArray(server) ? server : [];
  if (la.length === 0) return sa;
  if (sa.length === 0) return la;

  var map = {};

  // Indexer par id, _id, ou index si pas d'id
  function key(item, idx) {
    return (item && (item.id || item._id)) ? String(item.id || item._id) : '__idx_' + idx;
  }
  function ts(item) {
    var d = item && (item.updatedAt || item.createdAt || item.date || null);
    return d ? new Date(d).getTime() : 0;
  }

  sa.forEach(function(item, i) { map[key(item, i)] = item; });

  la.forEach(function(item, i) {
    var k = key(item, i);
    if (!map[k]) {
      map[k] = item; // unique au local → garder
    } else {
      // les deux ont cet élément → le plus récent gagne
      if (ts(item) > ts(map[k])) map[k] = item;
    }
  });

  return Object.values(map);
}

// ── Suppressions persistantes ("tombstones") ───────────────────────────
// Problème résolu : la fusion par ID ci-dessus ne sait jamais "oublier" un
// élément — si un appareil supprime un rendez-vous mais que le push réseau
// échoue (ou qu'un autre appareil n'a pas encore vu la suppression), le
// prochain syncFromServer le ré-importe car il existe encore côté serveur.
// On enregistre donc chaque suppression dans une collection séparée
// "<clé>__deleted" (qui se synchronise comme n'importe quelle autre clé
// mp_*) et on l'utilise pour filtrer définitivement ces ID des fusions.
function _tombKey(key) { return key + '__deleted'; }

function _getDeletedIds(key) {
  var arr = _storeGet(_tombKey(key), '[]');
  return (Array.isArray(arr) ? arr : []).map(function(t) { return String(t.id); });
}

function _markDeleted(key, id) {
  if (!id) return;
  var arr = _storeGet(_tombKey(key), '[]');
  if (!Array.isArray(arr)) arr = [];
  if (!arr.some(function(t) { return String(t.id) === String(id); })) {
    arr.push({ id: String(id), deletedAt: new Date().toISOString() });
    _storeSave(_tombKey(key), arr);
  }
}

function _filterTombstoned(key, list) {
  var deleted = _getDeletedIds(key);
  if (!deleted.length || !Array.isArray(list)) return list;
  return list.filter(function(item) {
    var id = item && (item.id || item._id);
    return !id || deleted.indexOf(String(id)) === -1;
  });
}

// ── Indicateur de sync visible ────────────────────────────────────────
var _syncIndicatorTimer = null;
function _showSyncIndicator(msg, color) {
  var el = document.getElementById('_mp_sync_dot');
  if (!el) {
    el = document.createElement('div');
    el.id = '_mp_sync_dot';
    el.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:88888;'
      + 'background:#1a1a1a;border:1px solid #2a2a2a;border-radius:20px;'
      + 'padding:5px 12px;font-size:11px;font-weight:600;letter-spacing:0.03em;'
      + 'display:flex;align-items:center;gap:6px;'
      + 'box-shadow:0 2px 12px rgba(0,0,0,0.5);transition:opacity 0.4s;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:' + (color||'#d4af37') + ';flex-shrink:0;"></span>'
    + '<span style="color:#ccc;">' + (msg||'Sync…') + '</span>';
  el.style.opacity = '1';
  clearTimeout(_syncIndicatorTimer);
  _syncIndicatorTimer = setTimeout(function() { el.style.opacity = '0'; }, 2500);
}

// ── Sync complet : merge garanti, push systématique ───────────────────
function syncFromServer(callback, silent) {
  if (!silent) _showSyncIndicator('Synchronisation…', '#d4af37');

  // Timeout généreux : les collections (ex. répertoire de contacts) peuvent
  // être volumineuses, surtout sur un réseau lent — éviter d'abandonner trop tôt
  // et de perdre la synchro de TOUTES les collections (taches, rappels, etc.).
  var _syncController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var _syncTimeout = _syncController ? setTimeout(function() { _syncController.abort(); }, 25000) : null;

  fetch('api.php?key=__all__&_=' + Date.now(), Object.assign({ cache: 'no-store' }, _syncController ? { signal: _syncController.signal } : {}))
    .then(function(r) { clearTimeout(_syncTimeout); return r.json(); })
    .then(function(res) {
      if (!res.ok || !res.data) {
        if (!silent) _showSyncIndicator('Hors ligne', '#ef4444');
        callback(); return;
      }

      var serverData = res.data;
      var toUpload   = {};

      // ── Étape 1 : traiter toutes les clés connues du serveur ─────
      Object.keys(serverData).forEach(function(k) {
        var sv    = serverData[k];
        var local = null;
        try {
          var rawLocal = localStorage.getItem(k);
          local = (rawLocal !== null) ? JSON.parse(rawLocal)
                : (Object.prototype.hasOwnProperty.call(_memCache, k) ? _memCache[k] : null);
        } catch(e) {}

        if (sv === null && local === null) return;

        if (sv === null) {
          // Serveur n'a pas cette clé → pousser local
          if (local !== null) toUpload[k] = local;
          return;
        }

        if (local === null) {
          // Local n'a pas cette clé → prendre serveur (en filtrant les suppressions connues)
          var svClean = Array.isArray(sv) ? _filterTombstoned(k, sv) : sv;
          _safeSet(k, svClean);
          _metaUpdate(k, new Date().toISOString());
          return;
        }

        // Les deux ont des données
        if (Array.isArray(sv) || Array.isArray(local)) {
          // Tableaux → fusion par ID (TOUJOURS, sans condition), puis on retire
          // définitivement tout élément supprimé localement (tombstones).
          var merged = _filterTombstoned(k, _mergeCollections(local, sv));
          _safeSet(k, merged);
          var now = new Date().toISOString();
          _metaUpdate(k, now);
          toUpload[k] = merged; // toujours pousser le résultat fusionné
        } else {
          // Objet/scalaire → timestamp décide
          var svTs  = (res.meta && res.meta[k]) ? new Date(res.meta[k].updatedAt).getTime() : 0;
          var locTs = _localMeta[k] ? _localMeta[k].ts : 0;
          if (svTs > locTs) {
            _safeSet(k, sv);
            _metaUpdate(k, res.meta[k].updatedAt);
          } else {
            toUpload[k] = local;
          }
        }
      });

      // ── Étape 2 : clés locales mp_* non connues du serveur ───────
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var lk = localStorage.key(i);
          if (!lk || !lk.startsWith('mp_')
              || lk === '_mp_sync_meta' || lk === '_mp_pending_keys'
              || lk === 'mp_auth_session') continue;
          // Marqueurs/journaux internes purement locaux — jamais synchronisés
          // (le serveur les rejette de toute façon, ALLOWED_KEYS ne les connaît pas)
          if (lk === 'mp_activity_log' || lk.indexOf('_restore') !== -1) continue;
          if (lk in serverData) continue;
          try {
            var lv = JSON.parse(localStorage.getItem(lk) || 'null');
            if (lv !== null) toUpload[lk] = lv;
          } catch(e) {}
        }
      } catch(e) {}

      // ── Étape 3 : push vers le serveur, une collection à la fois ──
      // (un envoi groupé de toutes les collections en un seul POST dépassait
      // la taille de requête acceptée par le serveur — erreur 413 — dès que
      // de grosses collections comme le répertoire de contacts grossissaient.)
      var uploadKeys = Object.keys(toUpload);
      if (uploadKeys.length > 0) {
        var pushTs = new Date().toISOString();
        uploadKeys.forEach(function(k) {
          _metaUpdate(k, pushTs);
          _pushCollection(k, toUpload[k], pushTs, function(ok) {
            if (ok) _pendingKeys.delete(k);
            else console.warn('[Mythos Sync] Échec envoi "' + k + '" — conservé en attente.');
            localStorage.setItem('_mp_pending_keys', JSON.stringify(Array.from(_pendingKeys)));
          });
        });
        console.log('[Mythos Sync] ↑ push ' + uploadKeys.length + ' collections (individuel)');
      }

      // ── Étape 4 : invalider cache rédaction ──────────────────────
      if (typeof _rdInvalidateCache === 'function') _rdInvalidateCache();

      if (!silent) _showSyncIndicator('✓ Synchronisé', '#22c55e');
      callback();
    })
    .catch(function(e) {
      console.warn('[Mythos Sync] Serveur indisponible — mode hors-ligne actif.');
      callback();
    });
}
