// MYTHOS PROD — BACKUP v1
// Sauvegarde, export, import, restauration — extrait de js/app.js lignes 1043-1316
// Dépendances globales : RESTORE_KEY_MAP (app.js), todayStr/escapeHtml (utils.js)

function _getAllData() {
  const data = { exportedAt: new Date().toISOString(), version: '1.0', appName: 'Mythos Prod' };
  Object.entries(RESTORE_KEY_MAP).forEach(([key, storageKey]) => {
    try { data[key] = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { data[key] = []; }
  });
  return data;
}

function exportBackup() {
  const data = _getAllData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'mythos-backup-' + todayStr() + '.json';
  a.click();
  URL.revokeObjectURL(url);
  if (typeof LOGGER !== 'undefined') LOGGER.log('EXPORT_BACKUP', { date: todayStr() });
}

function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      // Restaurer chaque clé reconnue
      let restored = 0;
      Object.entries(RESTORE_KEY_MAP).forEach(([key, storageKey]) => {
        if (Array.isArray(data[key])) {
          localStorage.setItem(storageKey, JSON.stringify(data[key]));
          restored++;
        }
      });
      if (restored === 0) { alert('Fichier invalide : aucune donnée reconnue.'); return; }
      // Sauvegarder la méta
      localStorage.setItem('mp_restore_meta', JSON.stringify({ restoredAt: new Date().toISOString(), source: file.name }));
      alert('Sauvegarde importée avec succès (' + restored + ' collection(s)).');
      renderBackupDashboard();
    } catch (err) {
      alert('Erreur de lecture : ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function createBackupVersion() {
  var label = prompt('Nom de la version (ex: avant-mise-a-jour) :');
  if (!label) return;
  var versions = JSON.parse(localStorage.getItem('mp_backup_versions') || '[]');
  versions.unshift({ id: 'ver_' + Date.now(), label: label, createdAt: new Date().toISOString(), data: _getAllData() });
  if (versions.length > 20) versions.length = 20;
  localStorage.setItem('mp_backup_versions', JSON.stringify(versions));
  alert('Version "' + label + '" cree.');
  renderBackupDashboard();
}

function exportVersionHistory() {
  var versions = JSON.parse(localStorage.getItem('mp_backup_versions') || '[]');
  if (!versions.length) { alert('Aucune version sauvegardee.'); return; }
  var blob = new Blob([JSON.stringify(versions, null, 2)], { type: 'application/json' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = 'mythos-versions-' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function pushAllToServer() {
  var btn = document.getElementById('btn-push-server');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Envoi en cours...'; }

  var bulk = {};
  Object.values(RESTORE_KEY_MAP).forEach(function(key) {
    try { bulk[key] = JSON.parse(localStorage.getItem(key) || 'null'); } catch(e) {}
  });

  fetch('api.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ __bulk__: bulk })
  })
  .then(function(r) { return r.json(); })
  .then(function(res) {
    if (btn) { btn.disabled = false; btn.textContent = '☁️ Synchroniser vers le serveur'; }
    if (res.ok) {
      alert('✅ ' + (res.saved || 0) + ' collection(s) synchronisées avec le serveur.\nVos données sont maintenant accessibles depuis tous vos appareils.');
    } else {
      alert('❌ Erreur : ' + (res.error || 'inconnue'));
    }
  })
  .catch(function(err) {
    if (btn) { btn.disabled = false; btn.textContent = '☁️ Synchroniser vers le serveur'; }
    alert('❌ Impossible de contacter le serveur.\nVérifiez que api.php est bien uploadé et que le dossier appdata/ existe.');
  });
}

function renderBackupDashboard() {
  var el = document.getElementById('backup-dashboard');
  if (!el) return;
  var versions = JSON.parse(localStorage.getItem('mp_backup_versions') || '[]');
  var totalSize = 0;
  Object.values(RESTORE_KEY_MAP).forEach(function(key) { totalSize += (localStorage.getItem(key) || '').length; });
  var sizeKb = (totalSize / 1024).toFixed(1);
  var counts = {};
  Object.entries(RESTORE_KEY_MAP).forEach(function(e) {
    try { counts[e[0]] = JSON.parse(localStorage.getItem(e[1]) || '[]').length; } catch(ex) { counts[e[0]] = 0; }
  });
  var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:28px;">' +
    '<div class="stat-section-card" style="text-align:center;"><div style="font-size:28px;">&#128190;</div>' +
    '<div style="color:#d4af37;font-size:20px;font-weight:800;">' + sizeKb + ' Ko</div>' +
    '<div style="color:#888;font-size:11px;">Taille donnees</div></div>' +
    '<div class="stat-section-card" style="text-align:center;"><div style="font-size:28px;">&#128230;</div>' +
    '<div style="color:#d4af37;font-size:20px;font-weight:800;">' + versions.length + '</div>' +
    '<div style="color:#888;font-size:11px;">Versions manuelles</div></div>' +
    '<div class="stat-section-card" style="text-align:center;"><div style="font-size:28px;">&#9729;</div>' +
    '<div style="color:#22c55e;font-size:14px;font-weight:700;margin-top:4px;">Auto</div>' +
    '<div style="color:#888;font-size:11px;">Sauvegarde serveur active</div></div>' +
    '</div>' +
    '<div class="stat-section-card" style="margin-bottom:20px;">' +
    '<div class="stat-section-title">Donnees actuelles</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:12px;">' +
    Object.entries(counts).map(function(e) {
      return '<div style="background:#111;border:1px solid #2a2a2a;border-radius:8px;padding:10px;text-align:center;">' +
        '<div style="color:#d4af37;font-size:18px;font-weight:800;">' + e[1] + '</div>' +
        '<div style="color:#888;font-size:10px;">' + e[0] + '</div></div>';
    }).join('') + '</div></div>';
  if (versions.length) {
    html += '<div class="stat-section-card" style="margin-bottom:20px;"><div class="stat-section-title">Versions manuelles</div>' +
      '<div style="margin-top:12px;">' +
      versions.map(function(v) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #2a2a2a;">' +
          '<div><div style="color:#ccc;font-weight:600;">' + escapeHtml(v.label) + '</div>' +
          '<div style="color:#555;font-size:11px;">' + (v.createdAt || '').slice(0,16).replace('T',' ') + '</div></div>' +
          '<div style="display:flex;gap:8px;">' +
          '<button class="btn btn-sm btn-outline" onclick="_restoreVersion(\'' + v.id + '\')">Restaurer</button>' +
          '</div></div>';
      }).join('') + '</div></div>';
  }
  // ── Bloc nettoyage disque ─────────────────────────────────────────
  html += '<div class="stat-section-card" style="margin-bottom:20px;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
      '<div class="stat-section-title" style="margin:0;">🗑 Gestion du disque serveur</div>' +
      '<button id="btn-disk-cleanup" onclick="runDiskCleanup()" class="btn btn-outline" ' +
        'style="font-size:12px;border-color:#ef4444;color:#ef4444;padding:5px 14px;">🧹 Nettoyer maintenant</button>' +
    '</div>' +
    '<div id="disk-cleanup-status" style="color:#555;font-size:12px;">Appuyez sur "Nettoyer" pour supprimer les vieux backups et libérer de l\'espace.</div>' +
    '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">' +
      '<div style="background:#111;border:1px solid #1e1e1e;border-radius:8px;padding:8px 14px;font-size:11px;">' +
        '<span style="color:#555;">Règle :</span> <span style="color:#888;">Max 10 backups · Supprimer si &gt; 7 jours</span></div>' +
      '<div style="background:#111;border:1px solid #1e1e1e;border-radius:8px;padding:8px 14px;font-size:11px;">' +
        '<span style="color:#555;">Cron OVH :</span> <span style="color:#888;">automatique chaque jour</span></div>' +
    '</div>' +
  '</div>';

  // ── Backups automatiques serveur ──────────────────────────────────
  html += '<div class="stat-section-card" id="server-backups-section">' +
    '<div class="stat-section-title">☁ Sauvegardes automatiques serveur</div>' +
    '<div id="server-backups-list" style="margin-top:12px;"><div style="color:#444;font-size:12px;text-align:center;padding:16px;">Chargement...</div></div>' +
    '</div>';

  el.innerHTML = html;

  // ── Charger la liste des backups serveur ──────────────────────────
  fetch('api.php?action=list_backups')
    .then(function(r) { return r.json(); })
    .then(function(res) {
      var listEl = document.getElementById('server-backups-list');
      if (!listEl) return;
      if (!res.ok || !res.backups || !res.backups.length) {
        listEl.innerHTML = '<div style="color:#444;font-size:12px;text-align:center;padding:16px;">Aucune sauvegarde encore — elle apparaîtra après votre prochaine action.</div>';
        return;
      }
      listEl.innerHTML = res.backups.map(function(b) {
        var d = new Date(b.ts * 1000);
        var dateStr = d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});
        var label = b.file.replace(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_/, '').replace('.json','').replace('auto_','');
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #1a1a1a;">' +
          '<div>' +
            '<div style="color:#ccc;font-size:12px;">● ' + dateStr + '</div>' +
            '<div style="color:#444;font-size:10px;">' + b.size + ' Ko · ' + escapeHtml(label) + '</div>' +
          '</div>' +
          '<button class="btn btn-sm btn-outline" onclick="_restoreServerBackup(\'' + b.file + '\')" style="font-size:11px;padding:3px 10px;">Restaurer</button>' +
        '</div>';
      }).join('');
    })
    .catch(function() {
      var listEl = document.getElementById('server-backups-list');
      if (listEl) listEl.innerHTML = '<div style="color:#555;font-size:12px;padding:10px;">Impossible de charger les sauvegardes serveur.</div>';
    });
}

// ── Nettoyage disque depuis l'interface ───────────────────────────────
function runDiskCleanup() {
  var btn = document.getElementById('btn-disk-cleanup');
  var status = document.getElementById('disk-cleanup-status');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Nettoyage…'; }
  if (status) status.style.color = '#888';

  fetch('api.php?action=cleanup&key=mythos2026clean')
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (btn) { btn.disabled = false; btn.textContent = '🧹 Nettoyer maintenant'; }
      if (!res.ok) {
        if (status) { status.textContent = '❌ Erreur : ' + (res.error || 'inconnue'); status.style.color = '#ef4444'; }
        return;
      }
      var freed = res.space_freed || '0 Mo';
      var deleted = res.backups_deleted || 0;
      var disk = res.disk_used_mb || 0;
      var msg = deleted > 0
        ? '✓ ' + deleted + ' backup(s) supprimé(s) · ' + freed + ' libérés · Disque : ' + disk + ' Mo'
        : '✓ Disque propre · ' + disk + ' Mo utilisés · Rien à supprimer';
      if (status) { status.textContent = msg; status.style.color = '#22c55e'; }
      // Recharger la liste des backups
      setTimeout(function() { renderBackupDashboard(); }, 800);
    })
    .catch(function() {
      if (btn) { btn.disabled = false; btn.textContent = '🧹 Nettoyer maintenant'; }
      if (status) { status.textContent = '❌ Impossible de contacter le serveur.'; status.style.color = '#ef4444'; }
    });
}

function _restoreVersion(id) {
  var versions = JSON.parse(localStorage.getItem('mp_backup_versions') || '[]');
  var ver = versions.find(function(v) { return v.id === id; });
  if (!ver) return;
  if (!confirm('Restaurer "' + ver.label + '" ?')) return;
  Object.entries(RESTORE_KEY_MAP).forEach(function(e) {
    if (ver.data && Array.isArray(ver.data[e[0]])) localStorage.setItem(e[1], JSON.stringify(ver.data[e[0]]));
  });
  alert('Version "' + ver.label + '" restauree.');
  renderBackupDashboard();
}

function _deleteVersion(id) {
  if (!confirm('Supprimer cette version ?')) return;
  var vs = JSON.parse(localStorage.getItem('mp_backup_versions') || '[]').filter(function(v) { return v.id !== id; });
  localStorage.setItem('mp_backup_versions', JSON.stringify(vs));
  renderBackupDashboard();
}

function _restoreServerBackup(filename) {
  if (!confirm('Restaurer la sauvegarde "' + filename + '" ?\nToutes les données actuelles seront remplacées.')) return;
  fetch('api.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ __restore_backup__: filename })
  })
  .then(function(r) { return r.json(); })
  .then(function(res) {
    if (!res.ok) { alert('Erreur : ' + (res.error || 'inconnue')); return; }
    // Recharger les données du serveur dans localStorage
    return fetch('api.php?key=__all__').then(function(r2) { return r2.json(); }).then(function(res2) {
      if (res2.ok && res2.data) {
        Object.entries(res2.data).forEach(function(e) {
          if (e[1] !== null) localStorage.setItem(e[0], JSON.stringify(e[1]));
        });
      }
      alert('✅ Sauvegarde restaurée (' + (res.restored || 0) + ' collections). La page va se recharger.');
      location.reload();
    });
  })
  .catch(function() { alert('Impossible de contacter le serveur.'); });
}
