// =====================================================
// MYTHOS OS — Notifications Service
// js/core/services/notifications.js
//
// Unified notification/toast layer. Self-contained DOM toast
// (no dependency on module-local _tchToast/_rdToast).
// Bounded in-memory history (max 100 entries, newest first).
// Emits mythos:notification via Events bus when available.
//
// Schema: { id, type, message, title, timestamp, duration, source, data }
//
// Depends on: Events (optional), document (optional)
// Loaded: blocking, after widgets.js, before plugin-services.js
// =====================================================

var MythosNotifications = (function () {

  var _history    = [];
  var MAX_HISTORY = 100;

  function _genId() {
    return 'notif-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  }

  // A single persistent live region announces every toast to screen readers
  // (WCAG 4.1.3 Status Messages). It is visually hidden; the visual toast is
  // unchanged. Pre-existing live regions announce far more reliably than a
  // region inserted together with its text.
  function _liveRegion() {
    var id = 'mythos-live-region';
    var lr = document.getElementById(id);
    if (!lr) {
      lr = document.createElement('div');
      lr.id = id;
      lr.setAttribute('role', 'status');
      lr.setAttribute('aria-live', 'polite');
      lr.setAttribute('aria-atomic', 'true');
      lr.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;' +
        'padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;';
      document.body.appendChild(lr);
    }
    return lr;
  }
  function _announce(text, assertive) {
    if (typeof document === 'undefined' || !document.body) return;
    var lr = _liveRegion();
    lr.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
    // Clear then set on the next frame so repeated identical messages re-announce.
    lr.textContent = '';
    var set = function () { lr.textContent = text; };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(set);
    else set();
  }

  function _showDOMToast(entry) {
    if (typeof document === 'undefined' || !document.body) return;
    _announce((entry.title ? entry.title + ' : ' : '') + entry.message, entry.type === 'error');
    var accent = {
      success: '#22c55e', error: '#ef4444',
      warning: '#d4af37', info:  '#06b6d4'
    }[entry.type] || '#06b6d4';

    var el = document.createElement('div');
    el.style.cssText = [
      'position:fixed;bottom:24px;left:50%;',
      'transform:translateX(-50%) translateY(8px);',
      'z-index:99999;background:#1c1c1c;color:#e0e0e0;',
      'border-left:3px solid ' + accent + ';',
      'padding:10px 18px;border-radius:8px;font-size:13px;',
      'box-shadow:0 4px 20px rgba(0,0,0,.7);',
      'opacity:0;transition:opacity .2s,transform .2s;',
      'white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis;'
    ].join('');
    el.textContent = (entry.title ? '[' + entry.title + '] ' : '') + entry.message;
    document.body.appendChild(el);

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () {
        el.style.opacity   = '1';
        el.style.transform = 'translateX(-50%) translateY(0)';
      });
    } else {
      el.style.opacity = '1';
    }

    var dur = typeof entry.duration === 'number' ? entry.duration : 3000;
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 250);
    }, dur);
  }

  function notify(config) {
    if (!config || typeof config !== 'object') return null;
    var entry = {
      id:        config.id        || _genId(),
      type:      config.type      || 'info',
      message:   String(config.message || ''),
      title:     config.title     || null,
      timestamp: config.timestamp || new Date().toISOString(),
      duration:  typeof config.duration === 'number' ? config.duration : 3000,
      source:    config.source    || null,
      data:      config.data      || null
    };

    _history.unshift(entry);
    if (_history.length > MAX_HISTORY) _history.length = MAX_HISTORY;

    _showDOMToast(entry);

    if (typeof Events !== 'undefined' && typeof Events.emit === 'function') {
      try { Events.emit('mythos:notification', entry); } catch (e) {}
    }

    return entry;
  }

  function _merge(type, message, options) {
    var c = { type: type, message: message };
    if (options && typeof options === 'object') {
      var keys = Object.keys(options);
      for (var i = 0; i < keys.length; i++) c[keys[i]] = options[keys[i]];
    }
    return notify(c);
  }

  function info    (message, options) { return _merge('info',    message, options); }
  function success (message, options) { return _merge('success', message, options); }
  function warning (message, options) { return _merge('warning', message, options); }
  function error   (message, options) { return _merge('error',   message, options); }

  function getHistory  () { return _history.slice(); }
  function clearHistory() { _history = []; }

  return {
    notify:       notify,
    info:         info,
    success:      success,
    warning:      warning,
    error:        error,
    getHistory:   getHistory,
    clearHistory: clearHistory
  };

})();
