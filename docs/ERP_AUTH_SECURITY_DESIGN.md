# Mythos ERP — Stage 4: authentication, authorization and audit design

**Status:** design, validated in a throwaway PostgreSQL 15 instance.
**Not applied to production.** No `mythos_erp` database, no role, no table, no
row. PHP still disabled, ERP still loopback-only, nginx untouched.
**Schema:** `sites/erp.mythosprod.xyz/db/schema-auth.sql` (extends `schema.sql`)
**Date:** 2026-08-22.

---

## 1. Architecture

```
browser
  │  HTTPS, __Host- cookie (Secure, HttpOnly, SameSite=Lax)
  ▼
/api/v1/*  ── single boundary, deny by default
  │
  ├─ 1. authenticate   session token → sessions.token_hash → user
  ├─ 2. authorize      user_effective_permissions ∋ required key
  ├─ 3. validate       typed schema; unknown fields rejected
  ├─ 4. execute        repository call
  └─ 5. audit          audit_log INSERT in the SAME transaction
  ▼
PostgreSQL (loopback) — erp_app role: no DELETE, no DDL, audit_log append-only
```

Every request passes all five steps or none of them. A handler is not reachable
without 1 and 2; a state change cannot commit without 5, because the audit
insert shares the transaction. **An unaudited write is not "discouraged" — it
is not expressible.**

### 1.1 Why server-side sessions and not JWT

A JWT cannot be revoked before expiry without server state — so the stateless
argument only holds if you never need immediate logout, immediate role change,
or immediate lockout. This application has one backend and one database, and it
needs all three. Opaque random tokens in an indexed table give them for one
lookup per request. The token is stored as `sha256`, never in the clear: a
database dump must not yield live sessions, for the same reason it must not
yield passwords.

---

## 2. Authentication

| Concern | Decision |
|---|---|
| Hashing | **Argon2id**, m=19456 KiB, t=2, p=1 (OWASP minimum), per-user salt. `password_algo` stored beside the hash so future rehashing is possible; a `CHECK` makes a hash without an algorithm unrepresentable |
| Rehash | On successful login, if parameters are below current policy, rehash transparently |
| Token | 256-bit CSPRNG, sent as cookie value, stored as `sha256` |
| Cookie | `__Host-erp_session`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain` |
| Idle timeout | 8 hours (`idle_expires_at`, slid on use) |
| Absolute timeout | 12 hours (`absolute_expires_at`, never extended) |
| Rotation | New token on login, on privilege change, on password change |
| Revocation | `revoked_at` + `revoked_reason`; password change revokes **all** other sessions |
| CSRF | Double-submit: `csrf_hash` bound to the session, required on every unsafe verb, in addition to `SameSite` |
| MFA | TOTP, schema present (`mfa_secret`, `mfa_enabled`), **required for `super_admin`** when enabled in Stage 5 |

### 2.1 Password reset

Single-use, hashed at rest, 30-minute expiry, `consumed_at` recorded so replay
is *visible* rather than merely rejected.

**The response is identical whether or not the email exists.** A reset form that
answers differently is a user-enumeration oracle, and this application's login
page would otherwise be a directory of who works here. Reset completion revokes
every existing session for that user.

### 2.2 Lockout and rate limiting

Recorded in `login_attempts`, which stores **successes as well as failures** —
"who logged in, from where" is an audit question, and a table holding only
failures cannot answer it.

| Layer | Rule |
|---|---|
| Per account | 5 failures → 15-minute lock (`locked_until`); exponential to a 1-hour cap |
| Per IP | 20 failures in 15 minutes → throttle, independent of account |
| Global | Fixed ~200 ms floor on the login path, success or failure |

**Lockout is time-based, never permanent.** A permanent lock reachable by
anyone who knows an email address is a denial-of-service tool, not a control.
The per-IP layer exists so one attacker cannot lock out an entire company by
cycling addresses; the account layer exists so a distributed attack cannot
brute-force one account. Neither alone is sufficient.

Constant-time comparison on the password path, and the response time floor,
prevent timing from revealing whether an account exists.

---

## 3. Authorization

Permission keys are `<module>.<action>`. `read`/`write`/`delete` are business
verbs; `manage` is administrative. **28 permissions across 10 modules.**

### 3.1 Role matrix (validated, not asserted)

| Permission | Super Admin | Admin | Manager | Production | Finance | Read Only |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| dashboard.read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| clients.read / .write / .delete | ✅✅✅ | ✅✅✅ | ✅✅— | ✅—— | ✅—— | ✅—— |
| projects.read / .write / .delete | ✅✅✅ | ✅✅✅ | ✅✅— | ——— | ✅—— | ✅—— |
| planning.read / .write | ✅✅ | ✅✅ | ✅✅ | ✅✅ | —— | ✅— |
| production.read / .write | ✅✅ | ✅✅ | ✅✅ | ✅✅ | —— | ✅— |
| finance.read / .write / .delete | ✅✅✅ | ✅✅✅ | ✅—— | ——— | ✅✅— | ✅—— |
| documents.read / .write / .delete | ✅✅✅ | ✅✅✅ | ✅✅— | ✅—— | ✅—— | ✅—— |
| reports.read / .export | ✅✅ | ✅✅ | ✅— | —— | ✅✅ | ✅— |
| inventory.read / .write | ✅✅ | ✅✅ | ✅— | ✅✅ | —— | ✅— |
| settings.read / .manage | ✅✅ | ✅✅ | —— | —— | —— | —— |
| users.read / .manage | ✅✅ | ✅✅ | —— | —— | —— | —— |
| **roles.manage** | ✅ | **—** | — | — | — | — |
| **audit.read** | ✅ | ✅ | — | — | — | — |
| **backup.manage** | ✅ | **—** | — | — | — | — |
| **Total** | **28** | **26** | **14** | **9** | **8** | **9** |

### 3.2 Three separations that carry weight

**Admin cannot assign roles.** An admin who can grant themselves `super_admin`
*is* a super admin with extra steps. Withholding `roles.manage` is what makes
the tier mean anything.

**Admin cannot restore backups.** Restore overwrites every collection at once —
the closest thing to a destroy button — so it sits with role assignment above
the operational tier.

**Admin *can* read the audit log.** Considered denying it for separation of
duty, and rejected: incident investigation is an admin's job, and denying it
would push routine work onto `super_admin`, which is strictly worse. Reading is
safe because **nobody can modify the trail** — the `erp_app` role has no
`UPDATE` or `DELETE` on `audit_log` at the database level, regardless of
application role.

**Read Only excludes `audit.read`, `settings.read` and `users.read`.** Who may
inspect the audit trail, the configuration and the user list is itself
privileged; "read only" means business data.

### 3.3 Enforcement

`user_effective_permissions` is a view joining users → roles → permissions,
filtered on `is_active AND deleted_at IS NULL`. The API asks it one question:
does this user hold this key. **Verified: deactivating a user drops their
effective permissions to 0 immediately** — no session sweep required, though
sessions are revoked as well.

The UI hides what a user cannot do. **The UI never enforces it.** Stage 1 found
authentication that existed only in `js/auth.js`; that mistake is not repeated.

---

## 4. Audit log

Append-only, one row per event, written in the transaction that caused it.
Columns: `occurred_at`, `actor_id`, `actor_label` (denormalised so the record
survives user retirement), `action`, `entity_table`, `entity_id`, `outcome`
(`ok|denied|error`), `detail` jsonb, `ip`.

**22 actions, enforced by CHECK constraint** — an invented action name is
rejected by the database, so the taxonomy cannot rot silently:

- **Authentication:** `login.success`, `login.failure`, `logout`, `session.revoked`
- **Credentials:** `password.reset_requested`, `password.reset_completed`, `password.changed`, `mfa.enabled`, `mfa.disabled`
- **Data:** `record.created`, `record.updated`, `record.deleted`, `record.restored`
- **Administrative:** `permission.denied`, `role.assigned`, `role.revoked`, `user.created`, `user.disabled`, `user.enabled`, `export`, `backup.created`, `backup.restored`

`permission.denied` is deliberately audited. A refused action is a security
event; a system that logs only what succeeded cannot show you an attack in
progress.

---

## 5. Database model

Added by `schema-auth.sql` on top of Stage 3:

| Table | Purpose |
|---|---|
| `sessions` | opaque server-side sessions; `token_hash`, `csrf_hash`, idle + absolute expiry, revocation reason, ip, user agent |
| `login_attempts` | success and failure; feeds lockout and rate limiting; indexed by email+time and ip+time |
| `password_reset_tokens` | single-use, hashed, expiring, `consumed_at` |
| `users` (+9 columns) | `password_algo`, `password_changed_at`, `must_change_password`, `failed_attempts`, `locked_until`, `mfa_secret`, `mfa_enabled` |
| `audit_log` | action taxonomy tightened to the 22 above |
| `user_effective_permissions` | view — the single authorization question |

Seeded: **6 roles, 28 permissions**, and the full matrix.

### 5.1 Validation performed

Applied `schema.sql` then `schema-auth.sql` to a throwaway `postgres:15-alpine`
(`--rm`, `--network=none`, no volume). Both reached `COMMIT` with **0 errors**.

```
super_admin has every permission                    PASS
admin CANNOT assign roles                           PASS
admin CANNOT restore backups                        PASS
read_only has NO write/delete/manage permission     PASS
read_only CANNOT read the audit log                 PASS
finance_user CANNOT write production                PASS
production_user CANNOT read or write finance        PASS
manager can read finance but not write it           PASS
only super_admin holds roles.manage                 PASS
audit.read held by super_admin and admin only       PASS
app role UPDATE / DELETE audit_log                  DENIED
app role DELETE sessions                            DENIED
invented audit action rejected                      PASS
password hash without algorithm rejected            PASS
disabled user → 0 effective permissions             PASS
```

One assertion failed on first run — *"only super_admin holds audit.read"* — and
investigation showed **the assertion was wrong, not the design**. It is
recorded here with its reasoning (§3.2) rather than quietly adjusted.

---

## 6. Security review

| Requirement | Status | Evidence |
|---|---|---|
| **No plaintext passwords** | ✅ | Argon2id only; `CHECK` forbids a hash without a recorded algorithm; passwords never logged, never in `detail` |
| **No insecure sessions** | ✅ | 256-bit tokens stored as sha256; `__Host-` + `Secure` + `HttpOnly` + `SameSite`; idle **and** absolute expiry; rotation on privilege change; revocable |
| **No direct database access from frontend** | ✅ | Browser reaches only `/api/v1/*`; PostgreSQL is loopback-only; credentials in a `0600` file outside the docroot and outside the repository |
| **No unauthenticated API design** | ✅ | Deny by default; authenticate → authorize before any handler; `permission.denied` audited |

**Stage 1 findings closed by this design:** C2 (no authentication) — the whole
of §2/§3. H4 (committed shared secret) — no shared secrets exist; administrative
actions are permissions held by roles. M9 (no audit log) — §4. M10 (unconfirmed
mass restore) — `backup.manage`, super-admin only, audited as
`backup.restored`.

**Defence that does not depend on application correctness:** `erp_app` has no
`DELETE` on business tables, no `UPDATE`/`DELETE` on `audit_log`, owns nothing,
and cannot alter structure. A fully compromised application still cannot erase
its own trail.

---

## 7. Implementation plan

| # | Step | Depends on |
|---|---|---|
| A1 | Provision `mythos_erp`, `erp_owner`, `erp_app`; apply both schema files | approval |
| A2 | API skeleton: the five-step pipeline, deny by default, no handlers yet | A1 |
| A3 | Argon2id hashing + login/logout + session issue, rotate, revoke | A2 |
| A4 | Rate limiting and lockout from `login_attempts` | A3 |
| A5 | Password reset: request, email, consume, revoke sessions | A3 |
| A6 | Permission middleware reading `user_effective_permissions` | A2 |
| A7 | Audit writer in-transaction; assert an unaudited write cannot commit | A2 |
| A8 | Bootstrap the first `super_admin` interactively; never a seeded default password | A3, A6 |
| A9 | Test suite: lockout timing, session expiry, privilege escalation attempts, audit completeness | A3–A7 |
| A10 | Security re-review against this document before any module is connected | A9 |

**A8 matters more than its size suggests.** A seeded default admin password is
how systems get compromised on day one; the first account is created
interactively at deploy time or not at all.

---

## 8. Stage 4 conclusion

Delivered: an authentication design with modern hashing and revocable
server-side sessions, an authorization model of 6 roles and 28 permissions with
three deliberate privilege separations, an audit taxonomy of 22 actions enforced
by the database, the schema to support all of it, and a validation run proving
the matrix behaves as described.

**Not done, deliberately:** no production table, database or role created; no
code written; no module connected; no PHP enabled; no nginx change; ERP still
loopback-only and still returning 403 publicly.

**Module migration must not begin until this design is approved** — and until
A1–A10 exist, because a ported module with no authenticated API to call would
otherwise be wired to the Stage 1 endpoints, which is the exact outcome this
stage exists to prevent.
