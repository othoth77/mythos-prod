/* MYTHOS WP — hash router. Routes: '#/path/:param?query'. */
export function parseHash(hash) {
  const raw = (hash || '#/dashboard').replace(/^#/, '');
  const [pathPart, query] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  return { path: '/' + segs.join('/'), segs, query: query || '' };
}
export function navigate(route, replace) {
  if (replace) history.replaceState(null, '', route); else location.hash = route.replace(/^#/, '');
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}
export function match(pattern, segs) {
  const p = pattern.split('/').filter(Boolean);
  if (p.length !== segs.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(segs[i]);
    else if (p[i] !== segs[i]) return null;
  }
  return params;
}
