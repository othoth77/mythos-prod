/* Mythos ERP — session and tenant context.
 *
 * The session cookie is HttpOnly and never visible here. What the browser keeps
 * is the CSRF token (returned once at login), the user, the tenants the user may
 * enter and the active tenant id. sessionStorage: survives a reload in this
 * tab, dies with it, is never shared across tabs or origins. A new tab resumes through
 * GET /session, which rotates the CSRF token and returns it (only its hash is
 * stored server-side, so the previous token cannot be re-issued).
 */
const KEY = 'mythos-erp-session';

let state = load();

function load() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') || empty(); }
  catch (e) { return empty(); }
}
function empty() { return { user: null, tenants: [], activeTenantId: null, csrf: null, meta: null }; }
function save() {
  try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable: memory only */ }
}

export const session = {
  csrf: () => state.csrf,
  user: () => state.user,
  tenants: () => state.tenants || [],
  activeTenantId: () => state.activeTenantId,
  activeTenant: () => (state.tenants || []).find((t) => t.id === state.activeTenantId) || null,
  meta: () => state.meta,
  isAuthenticated: () => !!(state.user && state.csrf),

  /* From POST /auth/login. */
  start(login) {
    state = {
      user: login.user, tenants: login.tenants || [], activeTenantId: login.active_tenant_id || null,
      csrf: login.csrf, meta: null
    };
    save();
  },
  /* From GET /session after a reload or in a new tab: the server rotates and
     returns a fresh CSRF token, so a valid cookie alone is enough to resume. */
  refresh(sess) {
    state.user = sess.user; state.tenants = sess.tenants || [];
    if (sess.active_tenant_id) state.activeTenantId = sess.active_tenant_id;
    if (sess.csrf) state.csrf = sess.csrf;
    save();
  },
  setActiveTenant(id) { state.activeTenantId = id; save(); },
  setMeta(meta) { state.meta = meta; save(); },
  end() { state = empty(); try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
};
