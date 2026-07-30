// =====================================================
// MYTHOS OS — Dialogs Service
// js/core/services/dialogs.js
//
// Promise-based wrappers for alert / confirm / prompt.
// Falls back to native window methods.
// All methods return Promises for async/await compatibility.
//
// Depends on: nothing (window is optional)
// Loaded: blocking, after notifications.js, before plugin-services.js
// =====================================================

var MythosDialogs = (function () {

  function alert(message, options) {
    return new Promise(function (resolve) {
      var msg = String(message || '');
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(msg);
      }
      resolve(undefined);
    });
  }

  function confirm(message, options) {
    return new Promise(function (resolve) {
      var msg    = String(message || '');
      var result = (typeof window !== 'undefined' && typeof window.confirm === 'function')
        ? window.confirm(msg) : false;
      resolve(!!result);
    });
  }

  function prompt(message, defaultValue, options) {
    return new Promise(function (resolve) {
      var msg = String(message || '');
      var def = (typeof defaultValue === 'string') ? defaultValue : '';
      var result = (typeof window !== 'undefined' && typeof window.prompt === 'function')
        ? window.prompt(msg, def) : null;
      resolve(result);
    });
  }

  return {
    alert:   alert,
    confirm: confirm,
    prompt:  prompt
  };

})();
