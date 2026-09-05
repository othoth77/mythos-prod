/* MYTHOS WP — API client. Same-origin JSON, CSRF header on every request,
   401 → sign-in page. Errors are thrown as { status, error, detail, errors }. */
export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.detail) || 'request failed');
    this.status = status; this.error = body && body.error; this.detail = body && body.detail; this.errors = body && body.errors; this.constraint = body && body.constraint; this.requestId = body && body.request_id;
  }
}

async function call(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'MythosWP', 'Accept': 'application/json' } };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opts); } catch (e) { throw new ApiError(0, { error: 'network', detail: 'The server could not be reached.' }); }
  if (res.status === 401) { window.location.replace('/login'); throw new ApiError(401, { error: 'unauthenticated', detail: 'Signed out.' }); }
  let json = null;
  try { json = await res.json(); } catch (e) { json = null; }
  if (!res.ok || !json || json.ok === false) throw new ApiError(res.status, json || { error: 'bad_response', detail: 'Malformed response.' });
  return json.data;
}

export const api = {
  get: (p) => call('GET', p),
  post: (p, b) => call('POST', p, b),
  patch: (p, b) => call('PATCH', p, b),
  put: (p, b) => call('PUT', p, b),
  del: (p) => call('DELETE', p),
  qs(obj) {
    const u = new URLSearchParams();
    Object.keys(obj || {}).forEach((k) => { const v = obj[k]; if (v !== undefined && v !== null && v !== '') u.set(k, v); });
    const s = u.toString();
    return s ? '?' + s : '';
  }
};
