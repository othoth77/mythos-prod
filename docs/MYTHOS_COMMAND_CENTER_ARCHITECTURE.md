# MYTHOS AI COMMAND CENTER — Architecture

**Stage:** MCC-1 (V1 command library)
**Code:** `projects/command-center/`
**Tests:** `tests/mcc-1-command-center-test.js`
**Domain:** `ordre.mythosprod.xyz`
**Subtitle:** Command Library for Mythos OS, Claude, Codex and AI Agents

---

## 1. What this is

A searchable, permanent library of the commands used to build and operate Mythos —
the AI instructions given to Claude and Codex, the verification procedures, the stage
gates. Each command is a stored object with its own explanation, safety class, version
history, notes and usage statistics.

The owner's three priority actions, in order, are **find a command**, **copy it**, and
**add a note**. The interface is arranged around exactly that.

### 1.1 What it is not

- **Not a command execution engine.** The application never runs a stored command, and
  cannot: the runtime contains no `child_process`, no `exec`, no `spawn`, no `eval` and
  no `Function` constructor. `tests/mcc-1-command-center-test.js` asserts this at source
  level across all nine runtime files, so it cannot regress unnoticed. A stored command
  is text that gets displayed, searched, filled in and copied.
- **Not coupled to any other Mythos product.** It owns the `mythos_command_center`
  database exclusively. No query reaches `idauto` or `ssangyong_autos`, no foreign key
  crosses a product boundary, and `db.js` pins `search_path` to the `mcc` schema.
- **Not multi-user.** Reads are public; writes need a bearer token. A real per-user model
  waits for a real Mythos identity service, which does not exist in this codebase.
- **Not an AI surface.** The recommendation and generation features are architecture-ready
  and deliberately unimplemented — see §9.

---

## 2. Why this shape

The repository already contains two production HTTP services built the same way
(`projects/idauto/reference/`, `projects/ssangyong-autos/reference/`). MCC-1 follows them
rather than introducing a stack:

| Concern | Choice | Precedent |
|---|---|---|
| HTTP | node `http`, no framework | `idauto/reference/api.js` (IDA-2C) |
| Database | PostgreSQL via `pg`, parameterized only | `ssangyong-autos/reference/db.js` |
| Front end | vanilla JS, no build step | `idauto/reference/admin-ui.js` |
| Tests | plain `node tests/<stage>-test.js` | every suite in `tests/` |
| Process | user-scope systemd on `deploy` | `ssangyong-storefront.service` |
| Ingress | nginx reverse proxy + certbot | `panel.mythosprod.xyz` |
| Credentials | `EnvironmentFile` outside the worktree | `/home/deploy/deployments/*/.env` |

No new build tooling, no new runtime dependency beyond `pg`, no parallel framework.

---

## 3. Data model

Schema `mcc` in database `mythos_command_center`, owner role
`mythos_command_center_owner`. This matches the verified host convention: one PostgreSQL
server (container `idauto-postgres`, `127.0.0.1:5432`) hosting one database per product
with its own owner role.

| Table | Holds |
|---|---|
| `mcc_commands` | the command itself: title, body, explanation, when-to-use, best practices, warnings, difficulty, safety level, status, version, variables, usage counter |
| `mcc_categories` | dynamic taxonomy, with `name_en` / `name_fr` / `name_ar` |
| `mcc_projects` | dynamic project list |
| `mcc_tags`, `mcc_command_tags` | dynamic tags, many-to-many |
| `mcc_command_relations` | `NEXT` / `PREVIOUS` / `RELATED` edges between commands |
| `mcc_command_versions` | append-only history; the pre-edit snapshot of every change |
| `mcc_favorites` | favourites with a custom rank |
| `mcc_usage_events` | append-only event log (`COPY`, `OPEN`, `USE`, `CUSTOMIZE`) |
| `mcc_notes` | notes scoped to a command, category, project, workflow, or nothing |
| `mcc_templates` | reusable templates (schema present, V2 surface) |
| `mcc_workflows`, `mcc_workflow_commands` | ordered command chains |

### 3.1 Decisions worth knowing

**Categories, tags and projects are rows, not enum types.** Adding one is an API call,
never a migration — which is what "the category system must be dynamic" requires.

**Favourites are a table, not a boolean column.** That is what makes custom ordering
possible, and a future multi-user build adds `user_id` here without touching
`mcc_commands`.

**`usage_count` is denormalised, `mcc_usage_events` is the truth.** The counter makes
sorting fast; the event log is what the today/week/month leaderboards are computed from,
and it is auditable. `OPEN` events are recorded but do not increment the counter —
otherwise browsing the library would inflate every leaderboard.

**Version history is append-only and stores the PREVIOUS state.** Every substantive edit
writes what the command *was* before the row changes. Nothing in the application deletes
from `mcc_command_versions`.

**There is no `DELETE` route anywhere.** Archiving is a status change (`ACTIVE` /
`ARCHIVED` / `DRAFT`) and is always reversible. Archived commands stay searchable behind
the Archived filter.

**Two search columns, deliberately.** `search_vector` is a generated weighted `tsvector`
(title > description > when-to-use/explanation > body) using the `simple` configuration,
which stems nothing — correct for a French/English/Arabic-ready corpus. `search_text` is
a generated accent-folded, lower-cased copy of the same fields, matched with `ILIKE` for
partial words and accent-insensitive queries. The folding uses `translate` rather than the
`unaccent` extension because a generated column requires an `IMMUTABLE` expression and
`unaccent()` is only `STABLE`. `api.js` folds the incoming query with the identical
character map — **the two lists must stay in lockstep**, and both files say so.

Replacing this with an external search engine later means replacing those two columns and
one query in `getCommands`. Nothing else reads them.

---

## 4. API

API-first: the UI is one client, not the only way in.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | identity + counts |
| GET | `/api/commands` | — | search and filter |
| POST | `/api/commands` | token | create |
| GET | `/api/commands/:idOrSlug` | — | full detail |
| PATCH | `/api/commands/:idOrSlug` | token | update (versioned) |
| GET | `/api/commands/:id/versions` | — | version history |
| POST | `/api/commands/:id/status` | token | archive / restore / draft |
| POST | `/api/commands/:id/duplicate` | token | duplicate as DRAFT |
| POST | `/api/commands/:id/favorite` | token | favourite / unfavourite |
| POST | `/api/commands/:id/usage` | **public** | record a copy |
| POST | `/api/commands/:id/render` | **public** | fill placeholders |
| GET | `/api/dashboard` | — | home screen in one round trip |
| GET | `/api/statistics` | — | totals + four leaderboards |
| GET/POST | `/api/categories`, `/api/tags`, `/api/projects` | read / token | taxonomy |
| GET/POST | `/api/notes`, PATCH `/api/notes/:id` | read / token | notes |
| GET | `/api/workflows` | — | command chains |
| GET | `/api/export` | — | full JSON export |
| GET | `/api/session` | token | check the held token's identity |

Search filters: `q`, `category`, `project`, `tag` (repeatable, AND semantics), `difficulty`,
`safety`, `status` (`ACTIVE` default, `ARCHIVED`, `DRAFT`, `ALL`), `favorite`, `sort`,
`limit`, `offset`.

`sort` is resolved through a whitelist, so the `ORDER BY` text can only ever be one of
seven literals. Every other value reaches SQL as a bound parameter.

---

## 5. Authorisation

`auth.js`, following `idauto/reference/identity.js`: `MCC_ADMIN_TOKENS` maps bearer tokens
to identity strings. Tokens are compared as SHA-256 digests through
`crypto.timingSafeEqual`, with no early exit.

**Reads are public.** Copying must not require a login, and the library holds no PII and
no secret — `secrets.js` refuses credential-shaped content at the write boundary, so by
construction there is nothing here to protect from a reader.

**Writes require a token,** because the site is on a public domain and the library is the
artefact that matters.

**`POST /api/commands/:id/usage` and `/render` are public exceptions.** A copy must record
without a token, since copying is the unauthenticated action. Those endpoints can only
move a counter or return text; neither can touch command content. The worst a stranger
can do is skew a leaderboard.

`server.js` **refuses to start** if `MCC_ADMIN_TOKENS` is unset, rather than starting with
an open write surface and logging a warning.

---

## 6. Security model

| Control | Where |
|---|---|
| No execution path of any kind | asserted at source level by the test suite |
| Secret-pattern gate on every write | `secrets.js`, called by `api.js` before any text is stored |
| Parameterized SQL only, no raw escape hatch | `db.js` exposes `query`/`transaction` only |
| Schema confinement | `db.js` pins `search_path=mcc`; `public` deliberately absent |
| XSS | front end never assigns `innerHTML`/`outerHTML`/`insertAdjacentHTML`; all dynamic text goes through `textContent` |
| CSP | `default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; object-src 'none'` — no inline script or style anywhere |
| Transport headers | nginx sets `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` on every response |
| Loopback binding | `server.js` binds `127.0.0.1` only; nginx is the sole public path |
| Error opacity | driver messages never leave the process; clients get `internal error` |
| Body limit | 512 KB, enforced without buffering past the limit |
| Credentials | `EnvironmentFile` at `/home/deploy/deployments/mythos-command-center/.env`, mode 0600, outside the worktree, never logged |

### 6.1 The secret gate

Two severities, because the ambiguity is real:

- **HIGH** — a recognised credential *format* (PEM private key, AWS key ID, GitHub token,
  Anthropic/OpenAI key, Slack token, Google API key, JWT, connection string with an inline
  password). The write is **refused outright**, HTTP 422. There is no override: a
  credential written once into a database is a credential to rotate, not to un-save.
- **MEDIUM** — a credential-shaped *assignment* (`password = …`) whose value is not
  obviously a placeholder. Returned as a **warning**; the write proceeds. This library
  legitimately contains `MCC_DB_PASSWORD=…` as documentation, and blocking that would make
  the gate useless by making it wrong.

Findings never carry the matched text back to the caller or into a log — only a rule name,
a field, a line number and a masked excerpt.

The seed loader runs the same gate, so it cannot become the one path into the database
that skips the check.

---

## 7. Safety classification

Every command carries one of `SAFE`, `READ_ONLY`, `WRITE`, `PRODUCTION`, `DESTRUCTIVE`,
shown as a coloured badge **and** as text, so the meaning does not depend on colour
perception.

`DESTRUCTIVE` and `PRODUCTION` commands interpose a warning dialog before the text reaches
the clipboard. The dialog states plainly that the application never runs a stored command,
so the caution lands on the real risk — what the text does if the owner runs it elsewhere —
rather than on the act of copying.

---

## 8. Interface

Desktop-first, responsive to phone. Dark and light themes, following the system preference
until the owner chooses.

**Localisation.** English and French are complete and selectable. Arabic is
architecture-ready, not shipped: `i18n.js` carries a per-locale `dir`, a fallback chain so
a partial translation degrades to English rather than showing raw keys, and `name_ar`
columns run through the database and API. `app.css` uses logical properties
(`margin-inline`, `inset-inline`, `border-inline`) throughout, so `dir="rtl"` is a
one-attribute change. Command bodies are pinned `direction: ltr` even in an RTL interface —
a reversed shell command is unreadable.

Enabling Arabic means adding one object to `LOCALES` and flipping `enabled` to `true`.
Shipping a half-translated Arabic UI would have been worse than English, and would have
hidden the fact that nobody who reads Arabic had reviewed it.

**Keyboard shortcuts.** `/` search · `c` copy the selected command · `f` toggle favourite ·
`n` new note · `Esc` close dialog. All except `Esc` are suppressed while typing, so `c`
inside a command body inserts a letter. `Esc` works everywhere, because it is the escape
hatch.

**Command variables.** `{{PLACEHOLDER}}` occurrences are discovered from the body itself
(the body is authoritative), merged with any declared labels and defaults. "Customize"
fills them and produces text to copy. Substitution is single-pass and dumb by design: a
filled value containing `{{X}}` is inserted literally and never expanded again. A
placeholder with no value is left exactly as written, never blanked — a command that
visibly still needs filling in is safer than one that looks complete and is wrong.

---

## 9. Deliberately not implemented

Per the owner's staging instruction, V1 ships the library and defers the rest with a named
home for each:

| Phase | Content | State |
|---|---|---|
| V2 | Templates, workflow stepping ("Start Workflow") | `mcc_templates`, `mcc_workflows` schemas exist and are populated; only display is built |
| V3 | Advanced analytics, bulk library management | statistics endpoint is the foundation |
| V4 | AI command recommendation | **architecture-ready, not implemented** — the search and statistics endpoints are the interface an agent would use. "Recommended" on the dashboard is an honest heuristic (active commands never used, newest first), not a pretend model |
| V5 | n8n integration | no coupling exists; the JSON API is the integration point |
| V6 | AI-generated and AI-improved commands | governed by the loop in §10 |

Nothing in V1 pretends to be an AI feature.

---

## 10. Future AI and the governance boundary

The long-term intent is that the library becomes a knowledge system that improves itself.
The permitted sequence is:

```
observe usage → identify repeated tasks → detect missing commands →
suggest new commands → detect duplicates → suggest improvements →
generate candidate → run validation → [ HUMAN APPROVAL ] → publish
```

The approval gate is not optional and is not a prompt the system can answer itself. This
mirrors `AGENTS.md` §24 (skill source must never silently rewrite itself) and
`docs/MYTHOS_AI_OPERATING_LAYER.md` §15. **Autonomous modification of the production
command library is not permitted**, and no code in MCC-1 provides a path to it.

---

## 11. Deployment

```
DNS  ordre.mythosprod.xyz  →  51.68.226.211        ← NOT YET CREATED (owner action)
  ↓
nginx  /etc/nginx/sites-enabled/ordre.mythosprod.xyz
  ↓  proxy_pass
127.0.0.1:3021   node  reference/server.js
  ↓  systemd --user (deploy), lingering enabled
PostgreSQL  container idauto-postgres  →  database mythos_command_center
```

- Unit source of truth: `projects/command-center/deploy/mythos-command-center.user.service`,
  installed at `~deploy/.config/systemd/user/mythos-command-center.service`.
- vhost source of truth: `projects/command-center/deploy/nginx-ordre.mythosprod.xyz.conf`,
  installed at `/etc/nginx/sites-available/ordre.mythosprod.xyz`. certbot rewrites the
  installed copy when the certificate is issued; do not hand-write the 443 block.

### 11.1 Hardening directives that had to be removed, and why

Three hardening settings copied from the sibling unit prevent the service from running at
all on this host. Each was removed only after observing the failure directly:

| Directive | Failure | Cause |
|---|---|---|
| `ProtectKernelTunables`, `ProtectClock` (and `ProtectKernelModules`, `RestrictNamespaces`) | `status=218/CAPABILITIES`, `Failed to drop capabilities: Operation not permitted` | each makes systemd drop capabilities from the bounding set, which an unprivileged **user** manager may not do |
| `MemoryDenyWriteExecute` | `Check failed: 12 == errno` in `BaselineCompiler::Build` — a crash **under load**, not at startup | V8 is a JIT; it maps memory writable then executable. MDWE is simply incompatible with running node |

Everything else is retained: `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`,
`ProtectHome=read-only`, `ProtectControlGroups`, `ProtectHostname`, `RestrictSUIDSGID`,
`RestrictRealtime`, `LockPersonality`, `SystemCallArchitectures`, `SystemCallFilter`,
`RestrictAddressFamilies`, and an empty `ReadWritePaths` — the process writes nothing to
the filesystem.

**Related finding, not fixed here:** `ssangyong-storefront.service` still carries
`ProtectKernelTunables`, `ProtectClock` and `MemoryDenyWriteExecute`, and is consequently
**inactive** on this host for exactly these reasons. That is a separate workstream and was
deliberately left untouched by MCC-1.

### 11.2 Operating

```bash
sudo -u deploy XDG_RUNTIME_DIR=/run/user/$(id -u deploy) systemctl --user status mythos-command-center
```

```bash
sudo -u deploy XDG_RUNTIME_DIR=/run/user/$(id -u deploy) journalctl --user -u mythos-command-center -n 50
```

`XDG_RUNTIME_DIR` is required — without it `systemctl --user` reports a misleading failure
to connect.

---

## 12. Seeding

`seed/library.json` holds 24 commands, 26 categories, 6 projects, 35 relations, 3 workflows
and 3 notes. Load with:

```bash
node projects/command-center/seed/load.js
```

The loader is idempotent and non-destructive: a command whose slug already exists is
**skipped**, never overwritten, because the owner's edited version is the more valuable
one. `--force-update` overwrites from the file — an explicit flag, not a default.

### 12.1 Provenance — read this before trusting the seed

Every seeded command is derived from canon that exists in this repository, principally
`AGENTS.md`; each command's `source` field names the numbered sections it came from, and
the test suite asserts that every command has one.

**The owner's original chat-session command texts are not in this repository.** A search of
`docs/`, `projects/` and `.claude/` during the MCC-1 audit found nothing. The seeded
commands are faithful reconstructions from the same canon those commands encoded — not the
owner's own wording. When the original texts are available they should be imported verbatim
over these.

---

## 13. Testing

`tests/mcc-1-command-center-test.js` — **502 assertions**, run against a real PostgreSQL
connection on an ephemeral port.

The suite **truncates every table it uses** and therefore refuses to run unless the
connected database name ends in `_test`. That guard is what makes truncation safe: pointed
at `mythos_command_center` it would erase the library, so the check is a hard abort.

```bash
env MCC_DB_HOST=127.0.0.1 MCC_DB_PORT=5432 MCC_DB_USER=mythos_command_center_owner MCC_DB_PASSWORD=... MCC_DB_NAME=mythos_command_center_test node tests/mcc-1-command-center-test.js
```

Coverage: pure modules (placeholders, versioning, secret detection, auth); source-level
execution and XSS guarantees; health and taxonomy; command CRUD, slug collision and
versioning; the secret gate over HTTP; search including accent folding, tag AND-semantics,
SQL-injection-shaped terms and paging bounds; copy tracking; favourites; archive, restore,
duplicate and the absence of DELETE; variable rendering; notes; relations and workflows;
dashboard and statistics; export; transport headers, 404/405/400/401/413 handling and
error opacity; and static integrity of the seed file including the 18 commands the owner
named explicitly.
