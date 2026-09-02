# MYTHOS MCP OAuth bridge

OAuth 2.1 + PKCE in front of the existing MYTHOS Gateway, so Claude Web (and any
MCP client that speaks the MCP authorization spec) can add **MYTHOS MCP** as a
custom connector and log in, instead of pasting a static token.

```
Claude Web ──OAuth 2.1 / PKCE──▶ nginx (mythosprod.xyz, TLS)
                                   ├─ /mcp, /authorize, /token, /register, /consent, /callback,
                                   │  /.well-known/oauth-*        ──▶ mcp-auth-proxy (127.0.0.1:8180)
                                   │                                    │ Bearer <dedicated ContextForge client token>
                                   │                                    ▼
                                   │                               ContextForge (mythos-contextforge:4444/mcp) ──▶ MYTHOS MCP tools
                                   ├─ /dex/                       ──▶ Dex OIDC (127.0.0.1:5556), one owner identity
                                   └─ /gateway/  (unchanged)      ──▶ ContextForge, static client tokens as before
```

**Public URL for Claude Web:** `https://mythosprod.xyz/mcp` (Streamable HTTP).
Claude discovers `/.well-known/oauth-protected-resource/mcp`, registers itself
(RFC 7591), sends the user through `/authorize` → proxy consent page → Dex login
→ `/callback` → `/token`, then calls `/mcp` with the proxy's bearer token. The
proxy validates that token and relays to ContextForge with its own credential.

## What this is not

Not a change to ContextForge, its authentication, its tokens or its nginx route.
`/gateway/mcp` still needs its own static client token and rejects the proxy's
tokens (asserted by the test). The bridge is a *second door* onto the same
gateway, with OAuth in front. Stop or remove it and nothing else changes.

## Components (all under `deployments/mythos-mcp-auth/`, network `mythos-mcp-auth_net` 10.0.61.0/24)

| Container | Image (digest-pinned) | Role | Exposure |
|---|---|---|---|
| `mythos-mcp-auth-proxy` | `ghcr.io/babs/mcp-auth-proxy:1.4.0` | OAuth 2.1 AS + bearer-checked reverse proxy | `127.0.0.1:8180` → nginx |
| `mythos-dex` | `ghcr.io/dexidp/dex:v2.45.0` | OIDC issuer `https://mythosprod.xyz/dex`, password DB with **one** static identity (the owner), no connectors | `127.0.0.1:5556` → nginx `/dex/` |
| `mcp-auth-redis` | `redis:7-alpine` | replay store: single-use codes, refresh-rotation reuse detection, single-use consent/state | private network only, password, 32 MB cap |

The proxy also joins `mythos-gateway_net` to reach ContextForge; the gateway's
own deployment is untouched.

## Identity and authorization

- **IdP:** Dex, chosen because no OIDC provider existed on the host and a public
  IdP (Google, GitHub) would admit *any* account — the proxy authorizes by
  groups, not by email allowlist. Dex holds exactly one identity; nobody else can
  log in. Memory cost ≈ 25 MB.
- **OAuth client:** Claude registers dynamically (public client, PKCE S256,
  `token_endpoint_auth_method=none`). The registration is sealed into the
  `client_id` (30-day TTL); nothing is stored.
- **Scopes:** none (`scopes_supported: []`). Authorization = "is the owner logged
  in". The tool-level permissions stay where they were: ContextForge's
  `mcp-auth-proxy@mythosprod.xyz` identity carries the tools-only role
  (`tools.read` + `tools.execute`), the same role as the ChatGPT/Claude static
  tokens.
- **Upstream credential:** a dedicated 365-day ContextForge client token issued
  with `projects/mythos-gateway/bin/cf-issue-client-token.sh`, stored in
  `contextforge-upstream.env` (0600) and referenced from the proxy env. It never
  reaches Claude. Rotation: revoke in ContextForge, delete the file, run
  `bin/install.sh` (re-issues), restart.

## Security controls

HTTPS only (Let's Encrypt on the apex) · OAuth 2.1 draft-13, PKCE required, strict
`state`, `resource` indicator (RFC 8707) bound into every token · AES-GCM-sealed
tokens audience-bound to `PROXY_BASE_URL` (1 h access, 7 d refresh, rotation with
reuse detection) · Redis-backed single-use codes · redirect URIs validated against
the sealed registration · consent page (CSP `default-src 'none'`, `form-action
'self'`) · per-IP rate limits in the proxy **and** nginx (`limit_req`, 429) · Dex
login form throttled to 20 req/min/IP · containers: digest-pinned, non-root
(uids 10002/10003/65532), `cap_drop ALL`, `no-new-privileges`, read-only rootfs,
memory caps · `Authorization`, `Cookie`, `X-Forwarded-*`, `X-User-*` stripped
before the upstream hop; the proxy injects `X-User-Sub` / `X-User-Email` for
audit at ContextForge · structured JSON logs with `request_id`, no token values.

## Files

| Path | Purpose |
|---|---|
| `docker-compose.yml` | topology (copied verbatim to the deployment) |
| `dex/config.yaml` | Dex config; secrets via `secretEnv` / `hashFromEnv` |
| `nginx/mythos-mcp-auth*.conf` | the apex vhost includes `snippets/mythos-mcp-auth.conf`; `conf.d/mythos-mcp-auth-limits.conf` holds the zones |
| `*-env.example`, `redis.conf.example` | templates; live files are 0600 and never committed |
| `bin/install.sh` | idempotent installer (root): secrets once, nginx, stack |
| `bin/oauth-e2e-test.py` | headless Claude-shaped walk of the whole flow + negatives (29 checks) |

## Operate

```bash
cd /home/deploy/deployments/mythos-mcp-auth
docker compose ps                                   # health
sudo -u deploy python3 oauth-e2e-test.py --login-file OWNER-LOGIN.txt   # full e2e
docker logs mythos-mcp-auth-proxy --since 1h | grep access_denied         # denials
```

Owner login for Dex: `OWNER-LOGIN.txt` (0600) — read it once, then rotate the
password (instructions inside). Signing-key rotation: `TOKEN_SIGNING_SECRETS_PREVIOUS`
(see the upstream `docs/runbooks/key-rotation.md`).

## Rollback

```bash
cd /home/deploy/deployments/mythos-mcp-auth && docker compose down
sed -i '/snippets\/mythos-mcp-auth.conf/d' /etc/nginx/sites-available/mythosprod.xyz
rm -f /etc/nginx/conf.d/mythos-mcp-auth-limits.conf /etc/nginx/snippets/mythos-mcp-auth*.conf
nginx -t && systemctl reload nginx
```
Then optionally revoke the `mythos-mcp-auth-proxy` token in ContextForge and
delete the deployment directory. `/gateway/` never depended on any of this.
