'use strict';
// =====================================================
// MYTHOS Browser MCP — the ONE in-page extraction, shared by both backends
// projects/mythos-browser-mcp/lib/page-text.js
//
// Measured 2026-09-29: Obscura 0.2.3's innerText is textContent — it carries
// <style> rules and every whitespace run of the markup (example.com's body
// text began with its CSS; a Wikipedia article came back as tabs and
// newlines). Chromium's innerText does not. So text mode reads a CLONE of
// the element with script/style/noscript/template/svg removed, then
// normalizes whitespace, and both engines run this same function: the same
// page gives the same text whichever backend served it.
//
// `extractInPage` is serialized into the page: it must stay self-contained
// (no closure, no require) and ES5.
// =====================================================

function extractInPage(a) {
  var el = a.selector ? document.querySelector(a.selector) : (document.body || document.documentElement);
  if (!el) return { found: false };
  var s;
  if (a.mode === 'html') {
    s = el.outerHTML || '';
  } else {
    var c = el.cloneNode(true);
    var drop = c.querySelectorAll ? c.querySelectorAll('script,style,noscript,template,svg') : [];
    for (var i = 0; i < drop.length; i++) { if (drop[i].parentNode) drop[i].parentNode.removeChild(drop[i]); }
    var tag = String(el.tagName || '').toLowerCase();
    s = (tag === 'script' || tag === 'style') ? '' : String((c.innerText !== undefined && c.innerText !== null ? c.innerText : c.textContent) || '');
    s = s.replace(/\r/g, '').replace(/[ \t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  return { found: true, chars: s.length, text: s.slice(0, a.max), truncated: s.length > a.max, title: document.title, href: location.href };
}

function args(opts) {
  opts = opts || {};
  return {
    selector: typeof opts.selector === 'string' && opts.selector.length <= 256 ? opts.selector : null,
    mode: opts.mode === 'html' ? 'html' : 'text',
    max: Math.max(256, Math.min(Number(opts.max_chars) || 20000, 200000))
  };
}

// For CDP Runtime.evaluate: an expression that returns the result as a JSON string.
function expression(opts) {
  return 'JSON.stringify((' + extractInPage.toString() + ')(' + JSON.stringify(args(opts)) + '))';
}

module.exports = { extractInPage: extractInPage, args: args, expression: expression };
