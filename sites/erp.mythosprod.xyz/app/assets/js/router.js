/* Mythos ERP — hash router.
 *
 * #/<module>[/<resource>[/<id>]]. Unknown modules fall back to the dashboard;
 * a traversal-shaped hash (#/../x) normalises to the dashboard too. The router
 * knows nothing about data: it hands the parsed route to the app, which knows
 * which view owns which module.
 */
export const DEFAULT = 'dashboard';

export function parse(hash, known) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').map((p) => decodeURIComponent(p).toLowerCase().trim()).filter(Boolean);
  const mod = parts[0] || DEFAULT;
  if (!known.includes(mod) || /\.\./.test(mod)) return { module: DEFAULT, resource: null, id: null };
  return { module: mod, resource: parts[1] || null, id: parts[2] || null };
}

export function go(path) { window.location.hash = path.startsWith('#') ? path : '#/' + path.replace(/^\//, ''); }

export function start(known, onRoute) {
  const fire = () => onRoute(parse(window.location.hash, known));
  window.addEventListener('hashchange', fire);
  fire();
}
