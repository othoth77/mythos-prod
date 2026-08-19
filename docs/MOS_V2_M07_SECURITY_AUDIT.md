# MOS-v2 M-07 — Operator safety audit: Mythos OS Console write surface

**Scope:** `projects/mythos-os-console/reference/` (`server.js`, `auth.js`, `upstream.js`,
`model-catalog.js`, `audit.js`, `web/app.js`, `web/login.js`) and the executor relay path
(`projects/mythos-ai-executor/server.js`, `lib/policy.js` — **read-only**, not modified).

**Baseline verified before starting:** `node tests/mos-1-console-test.js` → 832 passed / 0 failed;
`node tests/mythos-ai-executor-test.js` → 158 passed / 0 failed.

**Method:** source review plus live adversarial probes against the real server with a stub
executor (prototype-pollution payloads, duplicate JSON keys, unicode/case variants, path-traversal
and query-smuggling task ids, method matrix, body-limit overruns, unauthenticated write matrix).
Findings that required a change were fixed console-side only, each with new assertions in
`tests/mos-1-console-test.js` §4g/§4h.

---

## 1. Verdicts

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Authentication | **SAFE** | Session resolved once, before routing, at `server.js:856` (`auth.sessionFor`); write routes refused at `server.js:873`; non-public reads refused at `server.js:885`. `PUBLIC_PATHS` is a six-entry membership check (`server.js:134-141`), consulted with `hasOwnProperty` (`server.js:877`) — no prefix, no pattern, `/__proto__` probe → 404. Throttle: 10 failures / 15 min, checked *before* the body is read (`auth.js:65-66,239-244`; `server.js:450`); once engaged it refuses the correct password too (existing §5f). Lifetime absolute, 8 h, no idle renewal (`auth.js:52,159`); expiry enforced per-request, not only by sweep (`auth.js:174`). Re-login rotates: previous id destroyed before the new one is minted (`server.js:486-491`). Logout destroys the server-side entry first, then clears the cookie (`server.js:507-511`). |
| 2 | Authorization (profile gate) | **SAFE** | `MOS_ALLOW_REPO_WRITE` read fresh per request, never cached (`server.js:657`), and in exactly two places (pinned by an existing assertion). Probes: `REPO-WRITE`, `repo‑write` (U+2010 hyphen), `repo-write ` (trailing space), `' repo-write'`, `['repo-write']`, `{…}`, `5`, `''` → all 400; `repo-write` unauthorized → 403 `profile_not_authorized`. `__proto__` and `constructor` keys → 400 `unexpected field` (JSON.parse makes them own properties, so the `Object.keys` allowlist at `server.js:605` catches them). Duplicate JSON keys: last-wins, and the *same* parsed value is both validated and relayed — `{"execution_profile":"repo-read","execution_profile":"repo-write"}` → 403, the reverse → relays `repo-read`. No TOCTOU between check and use. |
| 3 | CSRF / session cookie | **SAFE** | Serialized cookie observed on the wire: `mos_session=<64 hex>; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=28800` (`auth.js:218-222`); cleared cookie carries the same attributes (`auth.js:224-226`). No state-changing GET exists — writes are only reachable when `req.method === 'POST'` (`server.js:839`). `form-action 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `object-src 'none'` in CSP (`server.js:98-101`). No CORS header is ever emitted, so no cross-origin reader. SameSite=Strict is what makes the five POST relays safe without a token; a cross-site `text/plain` form post to `/api/login` can produce parseable JSON but only ever with a password the attacker already knows, so login-CSRF has no gain. |
| 4 | Execution-profile enforcement | **SAFE** | `handleStartMission` is the only caller of `upstream.post('/tasks', …)` (`server.js:678`); the four `upstream.post` call sites in the file are pinned to `/tasks`-prefixed endpoints by an existing assertion. `payload.execution_profile` is read only inside `handleStartMission` (existing assertion counts 0 reads elsewhere), and the value relayed is the validated local `profile` variable. `project`, `requested_by`, `expected_delivery` are literals fixed server-side. Instruction text is relayed as a data field only; the executor selects tools from task metadata, never from the instruction (`lib/policy.js:9-11`). |
| 5 | Model allowlisting | **SAFE** | `modelCatalog.isAllowed` is the only gate (`server.js:631`) and consults `enabledModels()`, so a disabled entry can never be selected (`model-catalog.js:67-76`). Probes: `gemini` provider → 400 at the provider check; `opus ` (trailing space) and `../../etc` → 400. `/api/dispatcher` re-projects each entry into a fresh object and never emits `enabled` (`server.js:295-301`). No request path writes to `CATALOG`: the module is required only by `server.js`, which calls two pure readers. |
| 6 | Path traversal | **SAFE** | `STATIC` and `PUBLIC_PATHS` are literal maps read via `hasOwnProperty` (`server.js:877,913`); no request path is ever joined onto a directory (existing assertion). `TASK_ID_RE = [a-z0-9][a-z0-9-]{6,62}[a-z0-9]` (`server.js:373`) — alphabet excludes `.`, `/`, `%`, `?`, `#`, whitespace and control characters, and bounds the length at 8–64. All four route regexes are `^…$`-anchored (`server.js:374-375,523-524`). Probes: `/api/missions/..%2f..%2ftasks/cancel`, `…/cancel/../dispatch`, `tk-…%3fx=1/cancel` → 405 (no route matched, so no upstream call); `/%2e%2e/%2e%2e/etc/passwd` → 404. The console id alphabet is a strict subset of the executor's own `[a-z0-9-]{8,64}`. |
| 7 | Credential isolation | **GAP — fixed** (see F2) | Verified safe: the upstream bearer token exists only in `upstream.js` and is never in a response (existing §5e sweep); `auth.js` never writes to stdout/stderr (existing assertion) and the secret never leaves `verifyPassword`; the 0600-or-tighter file discipline and the "environment is not a secret store" rule are unchanged (`auth.js:84-115`) and still pinned by §5d. **Gap:** `/api/health` passed the executor's `/health` body through *verbatim* (`detail: up.detail`) — the only relay in the file without a field allowlist. No credential is in that body today (`executor.js:822-851`), so this was a passthrough, not an active leak; fixed anyway (F2). |
| 8 | Request size | **SAFE** | login 4 KB (`server.js:456`), logout 1 KB (`server.js:507`), cancel 1 KB (`server.js:797`), dispatch 1 KB (`server.js:824`), start 32 KB (`server.js:598`). Every write route reads its body through the single `readBoundedBody` (existing assertion: no other body reader may exist). nginx `client_max_body_size 64k` (`deploy/nginx-os.mythosprod.xyz.conf:37`) is still ≥ the 32 KB maximum plus margin — consistent. |
| 9 | Cancellation | **SAFE** | The relay takes no payload beyond the regex-validated task id (`server.js:795-812`); the body is drained, never parsed. It cannot target an arbitrary string (item 6). Replay is harmless: the executor answers 409 for an already-terminal task (`executor server.js:187-189`), which the console surfaces as a failure, and a repeated cancel of a live task is a repeated SIGTERM to the same pid. Both outcomes are now audited (F1). |
| 10 | Invalid mission input | **SAFE** | Every field's failure mode is a 400 *before* any upstream call: JSON shape, unexpected-field allowlist, title, instruction, provider, model, execution_profile, priority (`server.js:599-672`). The existing M-04 assertion proves zero upstream calls for eight rejected/unauthorized requests. Unexpected-field refusal is complete: `START_MISSION_FIELDS` is a six-name allowlist and any other key — including `__proto__`/`constructor` — refuses the request. |
| 11 | Unauthorized execution | **SAFE** | Unauthenticated POST to start / logout / cancel / dispatch → 401 `unauthenticated` (probed). Non-POST to any write path → 405 before routing (`server.js:839-846`). Exactly five write routes, exactly one `unauthenticated: true`, and it is `/api/login` — all three pinned by existing assertions on the `WRITE_ROUTES` source block. |
| 12 | Auditability | **GAP — fixed** (see F1) | Before this stage the console emitted **nothing** for any state-changing action (grep for `console.log`/`process.stdout` in `reference/*.js` returned only the startup line). Missions could be created, cancelled and dispatched, and operators signed in and out, with no record. The executor's own task events begin at task creation, so refusals — throttled sign-ins, rejected missions, denied repo-write, unauthenticated write attempts — were unrecorded anywhere. Fixed by `audit.js` (F1). |

---

## 2. Fixes applied (console side only)

### F1 — Append-only operator audit log (checklist 12)

**New file:** `projects/mythos-os-console/reference/audit.js` (126 lines).
**Changed:** `projects/mythos-os-console/reference/server.js`.

One JSON line per state-changing action, written to stdout so it lands in the journal beside the
startup line — no new file, no rotation policy, no second store.

```json
{"ts":"…","log":"mos.audit","action":"mission.start","outcome":"accepted",
 "actor":"sess:115831a2","task_id":"tk-…","detail":{"profile":"repo-write","provider":"claude-code",
 "model":"opus","priority":"high","status":"RUNNING"}}
```

Recorded actions: `login` (`success` / `invalid_credentials` / `throttled`), `logout`,
`mission.start` (`accepted` / `rejected` with a reason code / `denied_profile` / `upstream_error`),
`mission.cancel` and `mission.dispatch` (`accepted` / `failed`), and `write.denied` for any write
attempted without a session. Reads are not audited; they change nothing.

What it structurally cannot write:

* **No password.** No call site passes one, and `detail` is filtered against a seven-name
  allowlist (`profile, provider, model, priority, status, reason, route`), so a future caller that
  hands it a credential-shaped key logs nothing rather than leaking.
* **No session identifier in full.** The actor is `sess:` plus the first 8 of 64 hex characters —
  enough to correlate one operator's actions, 224 bits short of replaying one. A malformed or
  absent identifier records as `unauthenticated`, never echoed.
* **No instruction or title text.** Those keys are simply not in the allowlist.
* **No caller-chosen strings.** `task_id` is re-validated against the route alphabet inside
  `audit.js`, so a URL cannot forge a second log line; the refused-write record logs the matched
  *route label*, never the raw path. Detail values are truncated at 64 characters.
* The write is wrapped so a broken stdout costs the record, never the request.

The unauthenticated-write record is written *before* the refusal, deliberately outside it, so the
boundary itself stays the single unconditional line the suite pins.

### F2 — `/api/health` upstream passthrough closed (checklist 7)

`server.js` now reduces the executor's `/health` body through `upstreamHealthView()` — an explicit
shape (`ok`, `time`, `checks.{store_writable, claude_cli, n8n, omniroute, queue}`), with the two
probe objects reduced to booleans and the queue histogram copied key-by-key under
`/^[A-Z_]{3,32}$/` + numeric-value checks. This matches the field-pick discipline every other relay
in the file already follows (`agentsView`, `TASK_DETAIL_*_FIELDS`, `MISSION_DISPATCH_FIELDS`).
Nothing in the browser reads this field, so there is no UI change.

### Tests

`tests/mos-1-console-test.js` §4g (behavioural) and §4h (source-level), +288 lines:
module-level allowlist probes against `audit.js` directly (hostile detail containing the console
secret, the executor token, instruction and title text, and a full 64-hex identifier — none
survives); malformed actor and task-id cases; one-line serialisation; `audit.js` reads no env var
and no file. Live-server probes with `process.stdout.write` captured: exactly one line per action
for every audited path, zero lines for read routes, correct actor attribution across sign-in →
mission → cancel → dispatch → sign-out, and the reduced health view dropping an unknown upstream
field carrying a credential. §4h pins that every `audit.record` call site names an action and an
outcome and passes no instruction/title/password, that `audit.js` is not served to the browser, and
that the write boundary did not become a branch.

---

## 3. Executor-side observations (documented, NOT fixed — out of scope)

1. **`policy.DEFAULT_PROFILE` is `repo-write`** (`lib/policy.js:112`), and `createTask` applies it
   whenever `execution_profile` is absent or falsy (`executor.js:106`). Any holder of the executor
   bearer token that omits the field gets write authority by default — a fail-*open* default. The
   console is unaffected: it always sends an explicit, validated profile, and defaults to
   `repo-read` itself. Recommend the executor default to `repo-read` and require the profile
   explicitly.
2. **The executor does not itself gate `repo-write`.** `MOS_ALLOW_REPO_WRITE` is a console-only
   switch; anything else holding the token (n8n, a shell) can create a `repo-write` task. Acceptable
   given the token is 0600 and loopback-bound, but the console's gate is a UI/relay control, not a
   system-wide one — worth stating plainly in the runbook.
3. **`POST /tasks/<id>/cancel` sends SIGTERM by pid without re-checking pid ownership** beyond
   `state.processAlive` (`executor server.js:190-191`). If a status file's pid were ever stale and
   recycled by an unrelated process of the same user, the signal would land on the wrong process.
   Narrow, pre-existing, executor-side.
4. `GET /health` is unauthenticated on the executor and reports n8n/OmniRoute reachability and the
   Claude CLI version. Loopback + Docker-bridge bound only; noted, not a finding.

---

## 4. Residual risks (console)

1. **Over-limit bodies close the connection instead of answering.** `readBoundedBody` rejects and
   destroys the socket, so a 5 KB login body or a 40 KB mission body yields a socket hang-up rather
   than a 400/413. Fail-closed and now audited (`mission.start:rejected`, reason `body_too_large`),
   but the client sees a network error rather than a stated refusal. nginx returns a proper 413
   above 64 KB. Cosmetic; left unchanged to avoid touching the read path.
2. **Wrong-method-to-a-write-route answers 404, not 405, for GET/HEAD.** `GET /api/login` and
   `GET /api/missions/start` fall through to the generic 404 (405 is returned for PUT/DELETE/PATCH).
   No information is disclosed either way; changing it would alter the read path for no security
   gain.
3. **An upstream 409 (cancel of an already-terminal task) surfaces as 502 `upstream_error`.**
   Honest but imprecise; the audit log now records `mission.cancel:failed` with the code.
4. **The login throttle keys on the socket address**, which is always 127.0.0.1 behind nginx, so it
   is effectively global (documented at `auth.js:230-237`). Conservative for a single-credential
   console, but a hostile client can lock the operator out for 15 minutes. Accepted by design.
5. **Sessions are in-memory**, so a restart signs everyone out — intended, recorded in `auth.js:36-39`.
6. **The audit log is stdout/journald**, not a tamper-evident store. Anyone who can already read the
   journal can read it; anyone with root can rewrite it. Proportionate to a single-operator console;
   a signed or off-host sink is the next step if the threat model grows.
7. **`style-src`/`font-src` still allow Google Fonts** (documented exception, `server.js:75-89`).
   Unchanged by this stage; self-hosting the two families removes it.

---

## 5. Validation

```
node --check projects/mythos-os-console/reference/server.js     → ok
node --check projects/mythos-os-console/reference/audit.js      → ok
node --check tests/mos-1-console-test.js                        → ok
node tests/mos-1-console-test.js         → 972 passed, 0 failed   (baseline 832; +139 new, +1 from
                                                                   the existing per-file loop over
                                                                   reference/*.js now covering audit.js)
node tests/mythos-ai-executor-test.js    → 158 passed, 0 failed   (executor untouched)
```

Changed: `reference/server.js` (+188/−25), `tests/mos-1-console-test.js` (+288).
Added: `reference/audit.js` (126 lines). No executor file was modified.
