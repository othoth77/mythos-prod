# MCP Federation Closeout — 2026-09-24

> Persistent project memory / handover for the completed Haddad ↔ ContextForge ↔ Claude Web MCP federation work.
>
> Scope: Issue #424 / PR #425 and the production MCP federation path.
>
> Core rule preserved: **SEARCH → REUSE → ADAPT → CONNECT → BUILD LAST.**

## 1. Final objective

The objective was to expose the existing Mythos MCP tools and the Haddad MCP tools through **one existing MCP endpoint**:

```
Claude Web
   ↓
https://mythosprod.xyz/mcp
   ↓
ContextForge
   ├── mythos-mcp → 8 tools
   └── haddad     → 9 tools
                         ↓
                      17 tools
```

Architectural constraints:

- Do not create `/mcphaddad`.
- Do not create a second MCP endpoint.
- Do not create a second MCP server.
- Do not add another OAuth layer.
- Do not rebuild Haddad MCP.
- Reuse the existing ContextForge, mcp-auth-proxy, OAuth and MCP infrastructure.

## 2. Final verified state

As of 2026-09-24:

- Haddad MCP: **9 tools** — verified.
- Mythos MCP: **8 tools** — verified.
- ContextForge federation: **17 tools** — verified.
- Direct ContextForge `/mcp`: **17 tools** — verified.
- Public `https://mythosprod.xyz/mcp`: **17 tools** — verified with a fresh OAuth flow.
- Fresh OAuth E2E: **29/29 checks passed**.
- A real Haddad `tools/call` through the public MCP path returned **HTTP 200**.
- Claude Web connector after OAuth reconnect: **17 tools** — verified from the Claude connector UI.
- Final total: **17 = 8 Mythos + 9 Haddad**.

The final Claude-visible Haddad tools were:

- `Haddad-budget-status`
- `Haddad-capability-registry`
- `Haddad-execution-report`
- `Haddad-execution-status`
- `Haddad-haddad-health`
- `Haddad-knowledge-get`
- `Haddad-knowledge-search`
- `Haddad-project-context`
- `Haddad-system-health`

The final Claude-visible Mythos tools were:

- `Mythos-mcp-budget-status`
- `Mythos-mcp-capability-registry`
- `Mythos-mcp-execution-report`
- `Mythos-mcp-execution-status`
- `Mythos-mcp-knowledge-get`
- `Mythos-mcp-knowledge-search`
- `Mythos-mcp-project-context`
- `Mythos-mcp-system-health`

## 3. Haddad MCP verification

Haddad MCP itself was verified independently before federation.

The same 9 tools were available through:

- stdio
- loopback HTTP
- Tailscale HTTPS

Exactly one `server.js` process was verified for the active server architecture.

The offline MCP suite passed:

**22/22.**

Wrong or missing bearer authentication returned 401 as expected.

Conclusion: **Haddad MCP was not the source of the 8-tool symptom.**

## 4. ContextForge registration and federation

Haddad was registered as a gateway in the existing ContextForge installation.

After registration:

```
mythos-mcp = 8 tools
haddad     = 9 tools
---------------------
total      = 17 tools
```

The existing Mythos MCP gateway was not duplicated.

The existing public `/mcp` endpoint was retained.

## 5. Registration blocker: SSRF / Tailscale CGNAT

During gateway registration, ContextForge returned HTTP 422.

Root cause:

- Haddad resolves to `100.78.7.10`.
- This is inside Tailscale's `100.64.0.0/10` CGNAT range.
- The pinned ContextForge version blocked the full CGNAT range before consulting the explicit `SSRF_ALLOWED_NETWORKS` allowlist.
- Therefore an explicit `100.78.7.10/32` allowlist entry alone was ineffective.

Minimal production fix applied:

1. Explicit `SSRF_BLOCKED_NETWORKS` was set to the upstream default minus the required Tailscale CGNAT range.
2. Metadata, loopback, link-local and other sensitive ranges remained blocked.
3. The validator was patched so an explicit `SSRF_ALLOWED_NETWORKS` entry can authorize the intended CGNAT address, analogous to the existing RFC1918 handling.
4. The validator patch was mounted read-only over the image file.
5. Image digest remained unchanged.
6. A rollback script was retained.

Security matrix verification:

**15/15 passed.**

Only the intended Haddad address was allowed; adjacent CGNAT and other protected ranges remained blocked.

## 6. Registration credentials

A scoped temporary registration token was used only for gateway registration.

After successful registration:

- temporary registration token file was removed;
- the token-bearing shell-history line was scrubbed;
- no registration JWT literal remained in the inspected history/profile/config locations;
- registration credentials were revoked/cleaned according to the available API path.

The mcp-auth-proxy upstream token was rotated:

```
r2 → r3
```

The old token was confirmed rejected and its on-disk copies were shredded.

Do not reproduce or store token values in project memory.

## 7. Original 8-tool problem

After federation, ContextForge showed 17 tools, but Claude Web initially showed only the original 8 Mythos tools.

Observed state:

```
Haddad MCP       = 9
Mythos MCP       = 8
ContextForge     = 17
Claude connector = 8
```

The investigation considered:

- Virtual Server composition
- gateway/tool team ownership
- visibility
- RBAC
- token scope
- federation filtering
- registry policy
- nginx caching
- mcp-auth-proxy caching

## 8. Virtual Server hypothesis — excluded

The public route was traced as:

```
nginx
  ↓
mcp-auth-proxy
  ↓
ContextForge root /mcp
```

The public `/mcp` path does not route through a ContextForge Virtual Server.

Therefore Virtual Server tool composition was **not** the cause of the observed 8-tool list.

## 9. Team / visibility / RBAC hypothesis — excluded

The registered Haddad gateway and its tools were verified as:

- `enabled=1`
- `visibility=public`
- `team_id=NULL`

The Mythos gateway remained associated with the owner's team.

The mcp-auth-proxy identity had the required `tools.read` permission.

ContextForge v1.0.9 access-control code was inspected. Public tools remain eligible for the relevant token shapes; a null team does not by itself hide a public tool.

Conclusion: **Haddad having no team was not the cause of the 8-tool symptom.**

## 10. Registry policy warning — separate from /mcp

The registry check reported Haddad tools with:

```
denied by default until a rule names it
```

This text comes from the declared governance policy matrix:

```
registry/mcp-permissions.json
```

and its policy evaluation logic.

The investigation established that this policy matrix is a governance/registry check and is **not in the request path of the public `/mcp` tools/list**.

Therefore the warning does not explain why Claude initially showed 8 tools.

The policy matrix still lacks an explicit `haddad-*` entry. Adding that pattern to the appropriate ContextForge policy entry would make the registry check fully green, but this is a separate cleanup task and is not required for the functioning 17-tool MCP endpoint.

## 11. Database verification

The ContextForge SQLite database was readable from inside the existing container without changing filesystem permissions.

The deployed state confirmed:

- Haddad gateway exists.
- Haddad tools exist.
- Haddad tools are enabled.
- Haddad tools are public.
- Haddad tools have no team.
- Mythos and Haddad together account for 8 + 9 tools.

The host-side `deploy` user could not directly read `mcp.db` because the data directory is owned by UID/GID 10001. No chmod/chown workaround was used.

## 12. Decisive end-to-end tests

The final tests were performed against the real production path, not merely the admin catalog.

### Direct ContextForge

```
tools/list = 17
```

### Public MCP

```
https://mythosprod.xyz/mcp

tools/list = 17
```

Breakdown:

```
8 Mythos
+
9 Haddad
=
17
```

### Real Haddad tool call

A Haddad health tool was called through the public MCP path and returned:

```
HTTP 200
```

### Fresh OAuth E2E

```
29 checks
29 passed
0 failed
```

The E2E test verified:

- OAuth
- `tools/list = 17`
- Haddad `tools/call` succeeds
- existing Mythos tools remain intact

The original 8 Mythos tools were byte-identical to the saved baseline.

## 13. Final Claude Web diagnosis

Once the server-side path independently returned 17 tools, the remaining 8-tool result in Claude was identified as a stale connector/session tool list.

The Claude connector had connected before Haddad federation was available and retained the previous 8-tool list.

The fix was:

**Disconnect / reconnect the existing MYTHOS MCP OAuth connector and complete the OAuth login again.**

After reconnect:

```
Claude Web = 17 tools
```

This was verified directly in Claude's connector UI.

No second endpoint or second OAuth layer was required.

## 14. Final architecture

The production architecture is now:

```
Claude Web
   ↓
existing MYTHOS MCP OAuth connector
   ↓
https://mythosprod.xyz/mcp
   ↓
nginx
   ↓
mcp-auth-proxy
   ↓
ContextForge root /mcp
   ├── mythos-mcp → 8 tools
   └── haddad     → 9 tools
   ↓
17 tools
```

Haddad remains behind its existing secure Tailscale HTTPS path.

No public Haddad MCP endpoint was created.

## 15. GitHub work completed

Issue:

- **#424 — Haddad MCP registration**

PR:

- **#425 — idempotent Haddad registration script**
- commit reported for the PR: `eaaaf308`
- remote branch was confirmed and mergeable at the time of verification.

The registration script was designed to:

- use the existing ContextForge gateway endpoint;
- be idempotent;
- detect existing Haddad registration;
- use the existing MCP architecture;
- avoid creating `/mcphaddad`;
- avoid creating another MCP server;
- verify the combined tool count where possible;
- clean temporary registration credentials after success.

## 16. Qwen review limitation

Qwen was used as an independent evidence reviewer, not as a network operator.

Its sandbox had:

- no network access;
- no access to `~/.config`.

Therefore Qwen could not honestly perform endpoint probes or credential cleanup.

It was used to independently review the measured evidence bundle.

The later VPS and Claude tests provided the actual end-to-end proof.

## 17. Remaining non-blocking items

### Registry policy matrix

The registry check can still report:

```
DEGRADED
```

because `haddad-*` is not yet explicitly declared in the governance policy matrix.

This does **not** prevent the public MCP endpoint from returning all 17 tools.

Treat it as a separate policy/documentation cleanup, not as an MCP federation failure.

### Issue #424 close-out

The detailed close-out comment was constrained by the automated sensitivity filter. The authoritative details are preserved in this project memory document.

## 18. Source-of-truth statement

**As of 2026-09-24, the Haddad MCP federation objective is completed and verified.**

The system uses:

- one MCP endpoint;
- one existing Claude connector;
- one existing ContextForge root;
- 8 existing Mythos tools;
- 9 Haddad tools;
- 17 total client-visible tools.

The original 8-tool Claude symptom was caused by the connector's stale session/tool-list state and was resolved by reconnecting the existing OAuth connector.

No second MCP endpoint, no `/mcphaddad`, no second MCP server, and no additional OAuth layer are required.

Future work must start from this verified state and must not reopen the solved 17-tool federation problem unless a new regression is observed.
