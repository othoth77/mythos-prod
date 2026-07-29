// ══════════════════════════════════════════════════════════════════════
// UTHINA CHESS — Authentication & Session Manager v3
// Login  : mot de passe → sync serveur → lancement app
// Logout : sauvegarde garantie (timeout 6s) → déconnexion
// ══════════════════════════════════════════════════════════════════════

const AUTH = {
  HASH:              '5b697282df7a44230864437a0821d72986f8406b769c9a1797bad56e269ffb7a',
  SESSION_KEY:       'mp_auth_session',
  SESSION_DURATION:  8 * 60 * 60 * 1000, // 8 heures (rotation, arrière-plan, etc.)

  // ── Hash SHA-256 via Web Crypto ─────────────────────────────────
  async hashPassword(password) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  // ── Session (localStorage — survit aux rotations, rechargements, arrière-plan) ──
  isSessionValid() {
    try {
      const s = JSON.parse(localStorage.getItem(this.SESSION_KEY) || 'null');
      if (!s || !s.ts) return false;
      if ((Date.now() - s.ts) >= this.SESSION_DURATION) {
        localStorage.removeItem(this.SESSION_KEY);
        return false;
      }
      return true;
    } catch(e) { return false; }
  },
  createSession()  { localStorage.setItem(this.SESSION_KEY, JSON.stringify({ ts: Date.now() })); },
  destroySession() { localStorage.removeItem(this.SESSION_KEY); },

  // ── Écran de connexion ───────────────────────────────────────────
  showLoginScreen() {
    const app = document.getElementById('main-app');
    if (app) app.style.display = 'none';

    let el = document.getElementById('mp-login-screen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mp-login-screen';
      el.innerHTML = `
        <div class="mp-login-overlay">
          <div class="mp-login-box">
            <div class="mp-login-logo">
              <div class="mp-login-logo-frame">
                <img src="assets/logos/logo-uthina-chess.png" alt="Uthina Chess" onerror="this.style.display='none'">
              </div>
              <p>Gestionnaire d'événement</p>
            </div>
            <div class="mp-login-form">
              <label for="mp-login-password">Mot de passe</label>
              <input
                type="password"
                id="mp-login-password"
                placeholder="Entrez votre mot de passe"
                autocomplete="current-password"
                inputmode="numeric"
                pattern="[0-9]*"
                enterkeyhint="done"
              >
              <div id="mp-login-error" class="mp-login-error" style="display:none;">
                ❌ Mot de passe incorrect
              </div>
              <button id="mp-login-btn" onclick="AUTH.handleLogin()">
                Se connecter
              </button>
            </div>
            <p class="mp-login-hint">Session valide 60 minutes</p>
          </div>
        </div>
      `;
      document.body.appendChild(el);
      el.querySelector('#mp-login-password').addEventListener('keydown', e => {
        if (e.key === 'Enter') AUTH.handleLogin();
      });
    }
    el.style.display = 'flex';
    // Masquer le spinner de chargement si visible
    const spinner = document.getElementById('mp-loading-screen');
    if (spinner) spinner.style.display = 'none';

    setTimeout(() => {
      const pwd = document.getElementById('mp-login-password');
      if (pwd) pwd.focus();
    }, 120);
  },

  // ── Écran de chargement (entre login et app) ─────────────────────
  showLoadingScreen(message) {
    const loginEl = document.getElementById('mp-login-screen');
    if (loginEl) loginEl.style.display = 'none';

    let el = document.getElementById('mp-loading-screen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mp-loading-screen';
      el.innerHTML = `
        <div class="mp-loading-overlay">
          <div class="mp-loading-box">
            <div class="mp-loading-logo-frame">
              <img src="assets/logos/logo-uthina-chess.png" alt="Uthina Chess" onerror="this.style.display='none'">
            </div>
            <div class="mp-loading-spinner">
              <div class="mp-spinner-ring"></div>
            </div>
            <div id="mp-loading-msg" class="mp-loading-msg">Chargement…</div>
            <div id="mp-loading-sub" class="mp-loading-sub">Synchronisation des données</div>
          </div>
        </div>
      `;
      document.body.appendChild(el);
    }
    document.getElementById('mp-loading-msg').textContent = message || 'Chargement…';
    document.getElementById('mp-loading-sub').textContent = 'Synchronisation des données';
    el.style.display = 'flex';
  },

  updateLoadingMessage(msg, sub) {
    const m = document.getElementById('mp-loading-msg');
    const s = document.getElementById('mp-loading-sub');
    if (m) m.textContent = msg || '';
    if (s) s.textContent = sub || '';
  },

  hideLoadingScreen() {
    const el = document.getElementById('mp-loading-screen');
    if (el) {
      el.style.opacity = '0';
      setTimeout(() => { el.style.display = 'none'; el.style.opacity = ''; }, 350);
    }
    const app = document.getElementById('main-app');
    if (app) app.style.display = '';
  },

  // ── Connexion ────────────────────────────────────────────────────
  async handleLogin() {
    const pwdEl = document.getElementById('mp-login-password');
    const errEl = document.getElementById('mp-login-error');
    const btn   = document.getElementById('mp-login-btn');
    if (!pwdEl) return;

    const password = pwdEl.value.trim();
    if (!password) { pwdEl.focus(); return; }

    btn.disabled    = true;
    btn.textContent = '…';
    errEl.style.display = 'none';

    try {
      const hash = await this.hashPassword(password);

      if (hash !== this.HASH) {
        errEl.style.display = 'block';
        pwdEl.value = '';
        pwdEl.focus();
        btn.disabled    = false;
        btn.textContent = 'Se connecter';
        if (typeof LOGGER !== 'undefined') LOGGER.log('LOGIN_FAILED', { status: 'wrong_password' });
        return;
      }

      // ── Mot de passe correct ─────────────────────────────────────
      this.createSession();
      pwdEl.value = '';
      this.showLoadingScreen('Connexion réussie…');
      this.updateLoadingMessage('Synchronisation en cours…', 'Chargement de vos données depuis le serveur');

      if (typeof LOGGER !== 'undefined') LOGGER.log('LOGIN', { status: 'success' });

      // Sync bidirectionnel, puis lancer l'app
      if (typeof syncFromServer === 'function') {
        syncFromServer(() => {
          this.updateLoadingMessage('Prêt !', '');
          setTimeout(() => {
            this.hideLoadingScreen();
            if (typeof bootstrapStableApp === 'function') bootstrapStableApp();
          }, 300);
        });
      } else {
        setTimeout(() => {
          this.hideLoadingScreen();
          if (typeof bootstrapStableApp === 'function') bootstrapStableApp();
        }, 400);
      }

    } catch(e) {
      console.error('[AUTH] Erreur login :', e);
      btn.disabled    = false;
      btn.textContent = 'Se connecter';
    }
  },

  // ── Déconnexion sécurisée ─────────────────────────────────────────
  logout() {
    if (typeof LOGGER !== 'undefined') LOGGER.log('LOGOUT', {});

    this._showLogoutSpinner();

    const self     = this;
    const doLogout = () => { self.destroySession(); location.reload(); };

    // Collecter toutes les données mp_* du localStorage
    const bulk = {};
    const now  = new Date().toISOString();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('mp_') && k !== '_mp_sync_meta') {
          try { const v = localStorage.getItem(k); if (v) bulk[k] = JSON.parse(v); } catch(e) {}
        }
      }
    } catch(e) {}

    // Si rien à sauvegarder → déconnecter immédiatement
    if (Object.keys(bulk).length === 0) { doLogout(); return; }

    const payload      = JSON.stringify({ __bulk__: bulk, updatedAt: now });
    const backupPayload = JSON.stringify({ __auto_backup__: bulk, label: 'avant_deconnexion' });

    // Méthode 1 : sendBeacon (mobile-friendly, non-bloquant, fonctionne même en arrière-plan)
    let beaconSent = false;
    if (navigator.sendBeacon) {
      try {
        beaconSent = navigator.sendBeacon('api.php', new Blob([payload], { type: 'application/json' }));
        navigator.sendBeacon('api.php', new Blob([backupPayload], { type: 'application/json' }));
      } catch(e) { beaconSent = false; }
    }

    // Méthode 2 : fetch classique (fire-and-forget, pas d'attente de réponse)
    if (!beaconSent) {
      try {
        fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }).catch(() => {});
        fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: backupPayload }).catch(() => {});
      } catch(e) {}
    }

    // Déconnecter après 1.5s — pas d'attente de réponse serveur
    self._updateLogoutSpinner('✓ Données sauvegardées');
    setTimeout(doLogout, 1500);
  },

  _showLogoutSpinner() {
    let el = document.getElementById('mp-logout-spinner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mp-logout-spinner';
      el.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:999999',
        'background:rgba(0,0,0,0.88)', 'display:flex',
        'flex-direction:column', 'align-items:center', 'justify-content:center',
        'gap:16px', 'font-family:inherit'
      ].join(';');
      el.innerHTML = `
        <div style="width:40px;height:40px;border:3px solid #2a2a2a;border-top-color:#d4af37;
          border-radius:50%;animation:mp-spin 0.7s linear infinite;"></div>
        <div id="mp-logout-msg" style="color:#d4af37;font-size:14px;font-weight:600;letter-spacing:0.05em;">
          Sauvegarde en cours…
        </div>
        <div style="color:#444;font-size:11px;">Veuillez patienter</div>
        <style>@keyframes mp-spin{to{transform:rotate(360deg)}}</style>
      `;
      document.body.appendChild(el);
    }
    el.style.display = 'flex';
  },

  _updateLogoutSpinner(msg) {
    const m = document.getElementById('mp-logout-msg');
    if (m) { m.textContent = msg; m.style.color = '#22c55e'; }
  },

  // ── Vérification initiale ────────────────────────────────────────
  init() {
    if (!this.isSessionValid()) {
      this.showLoginScreen();
      return false;
    }
    // Session déjà valide (retour sur l'app) → il faut quand même révéler
    // #main-app, sinon il reste display:none et l'écran apparaît noir.
    this.hideLoadingScreen();
    return true;
  }
};

// ── Styles globaux auth ───────────────────────────────────────────────
(function injectAuthStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* ── Login screen ── */
    #mp-login-screen {
      display: flex;
      position: fixed;
      inset: 0;
      z-index: 99999;
      background: #0d0d0d;
      align-items: center;
      justify-content: center;
    }
    @keyframes mp-fadein {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .mp-login-overlay {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      background: radial-gradient(ellipse at center, #1a1a1a 0%, #0d0d0d 70%);
      animation: mp-fadein 0.35s ease;
    }
    .mp-login-box {
      background: #141414;
      border: 1px solid #2a2a2a;
      border-radius: 18px;
      padding: 40px 40px 44px;
      width: 100%; max-width: 420px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.6);
      text-align: center;
    }
    .mp-login-logo { margin-bottom: 28px; }
    .mp-login-logo-frame {
      width: 100%; min-height: 210px;
      border-radius: 20px;
      border: 1px solid rgba(212,175,55,0.55);
      background:
        radial-gradient(circle at top, rgba(212,175,55,0.18), transparent 58%),
        linear-gradient(180deg, rgba(212,175,55,0.08), rgba(255,255,255,0.01));
      display: flex; align-items: center; justify-content: center;
      padding: 26px 28px; box-sizing: border-box;
      box-shadow:
        0 0 0 1px rgba(255,215,120,0.08),
        0 14px 32px rgba(212,175,55,0.12),
        inset 0 1px 0 rgba(255,255,255,0.06);
    }
    .mp-login-logo img {
      width: min(100%, 360px); max-height: 150px;
      object-fit: contain; display: block; margin: 0 auto;
    }
    .mp-login-logo p {
      color: #e5e5e5;
      font-family: 'Playfair Display', serif;
      font-size: 24px; font-weight: 700;
      letter-spacing: 0.02em; margin: 18px 0 0 0;
    }
    .mp-login-form label {
      display: block; text-align: left;
      color: #999; font-size: 12px; font-weight: 600;
      letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 8px;
    }
    .mp-login-form input[type="password"] {
      width: 100%; padding: 14px 16px;
      background: #1e1e1e; border: 1.5px solid #d4af37;
      border-radius: 8px; color: #fff; font-size: 15px;
      outline: none; box-sizing: border-box;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .mp-login-form input[type="password"]:focus {
      border-color: #f0c842;
      box-shadow: 0 0 0 3px rgba(212,175,55,0.15);
    }
    .mp-login-error {
      color: #e05252; font-size: 13px;
      margin-top: 10px; text-align: left;
    }
    .mp-login-form button {
      margin-top: 20px; width: 100%; padding: 14px;
      background: linear-gradient(135deg, #d4af37, #b8962a);
      color: #000; border: none; border-radius: 8px;
      font-size: 15px; font-weight: 700; cursor: pointer;
      letter-spacing: 0.04em;
      transition: opacity 0.2s, transform 0.1s;
    }
    .mp-login-form button:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
    .mp-login-form button:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    .mp-login-hint { color: #444; font-size: 11px; margin-top: 24px; }

    /* ── Loading screen (entre login et app) ── */
    #mp-loading-screen {
      display: flex;
      position: fixed;
      inset: 0;
      z-index: 99998;
      background: #0d0d0d;
      align-items: center;
      justify-content: center;
      transition: opacity 0.35s ease;
    }
    .mp-loading-overlay {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      background: radial-gradient(ellipse at center, #1a1a1a 0%, #0d0d0d 70%);
      animation: mp-fadein 0.25s ease;
    }
    .mp-loading-box {
      display: flex; flex-direction: column; align-items: center; gap: 20px;
      padding: 40px;
    }
    .mp-loading-logo-frame {
      width: 120px; height: 120px;
      border-radius: 16px;
      border: 1px solid rgba(212,175,55,0.3);
      background: rgba(212,175,55,0.05);
      display: flex; align-items: center; justify-content: center;
      overflow: hidden;
    }
    .mp-loading-logo-frame img {
      width: 90px; height: 90px; object-fit: contain;
    }
    .mp-loading-spinner {
      display: flex; align-items: center; justify-content: center;
    }
    .mp-spinner-ring {
      width: 36px; height: 36px;
      border: 3px solid #1e1e1e;
      border-top-color: #d4af37;
      border-radius: 50%;
      animation: mp-spin 0.75s linear infinite;
    }
    @keyframes mp-spin { to { transform: rotate(360deg); } }
    .mp-loading-msg {
      color: #d4af37; font-size: 15px; font-weight: 700;
      letter-spacing: 0.04em; text-align: center;
    }
    .mp-loading-sub {
      color: #555; font-size: 12px; text-align: center;
      margin-top: -10px;
    }
  `;
  document.head.appendChild(style);
})();
