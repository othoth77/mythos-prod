/* Mythos ERP — API client.
 *
 * One place that knows how to talk to /api/v1: same-origin cookies, the CSRF
 * header on every unsafe verb, JSON in and out, and one error shape. A 401
 * anywhere means the session is gone; the app is told once and shows the login.
 */
import { session } from './session.js';

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.error) || ('http_' + status));
    this.status = status;
    this.body = body || {};
  }
}

const listeners = { unauthenticated: [] };
export function onUnauthenticated(fn) { listeners.unauthenticated.push(fn); }

async function call(method, path, body, opts = {}) {
  const headers = { 'Accept': 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = session.csrf();
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  const res = await fetch('/api/v1' + path, {
    method, headers, credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch (e) { data = { error: 'bad_response' }; } }
  if (res.status === 401 && !opts.quiet401) {
    listeners.unauthenticated.forEach((fn) => fn());
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (path) => call('GET', path),
  post: (path, body) => call('POST', path, body),
  patch: (path, body) => call('PATCH', path, body),
  del: (path) => call('DELETE', path),
  quiet: { get: (path) => call('GET', path, undefined, { quiet401: true }) }
};

/* Build a query string from a plain object, dropping empty values. */
export function qs(params) {
  const p = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? '?' + p.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&') : '';
}

/* Human-readable message for an ApiError, never leaking raw internals. */
export function describeError(err) {
  if (!(err instanceof ApiError)) return 'Erreur inattendue.';
  const e = err.body && err.body.error;
  const map = {
    unauthenticated: 'Session expirée. Reconnectez-vous.',
    forbidden: 'Action non autorisée' + (err.body.required ? ' (' + err.body.required + ')' : '') + '.',
    csrf_failed: 'Jeton de session invalide. Rechargez la page.',
    no_active_tenant: 'Aucune entité active.',
    module_not_enabled: 'Module non activé pour cette entité.',
    not_found: 'Introuvable.',
    validation_failed: 'Données invalides' + (err.body.detail ? ' : ' + err.body.detail : '') + '.',
    invalid_credentials: 'Identifiants incorrects.',
    rate_limited: 'Trop de tentatives. Réessayez plus tard.',
    locked: 'Compte temporairement verrouillé.',
    internal_error: 'Erreur serveur.'
  };
  if (map[e]) return map[e];
  if (err.status === 409) return 'Conflit : ' + (e || 'la ressource a changé') + '.';
  if (err.status === 422) return 'Données invalides : ' + (e || 'vérifiez le formulaire') + '.';
  return 'Erreur ' + err.status + (e ? ' (' + e + ')' : '') + '.';
}
