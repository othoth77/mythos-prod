# Mythos OS — Cloudflare Deployment

**Status:** Documentation only (INF-CF-0). No deployment performed.

---

## Tunnel Model

Mythos OS uses a **remotely managed** Cloudflare Tunnel. The Tunnel is created and configured through the Cloudflare Zero Trust dashboard. A `cloudflared` container runs inside Coolify on the OVH VPS and connects outbound to Cloudflare.

This model has no local `config.yml` to maintain, no origin certificates to distribute manually, and no inbound ports to open on the VPS firewall.

## cloudflared Container

The `cloudflared` container uses the official `cloudflare/cloudflared` image and runs:

```
cloudflared tunnel run --token ${CLOUDFLARE_TUNNEL_TOKEN}
```

The Tunnel token is injected as an encrypted environment variable in Coolify. It must never appear in this repository.

## Credentials

- **No real credentials in this repository.** All values in `cloudflared.env.example` are empty placeholders.
- Real Tunnel tokens, Account IDs, API keys, R2 credentials, and origin certificates belong only in Coolify encrypted environment variables or an approved secret manager.
- If any credential is ever committed, rotate it immediately.

## Deployment Status

INF-CF-0 is **documentation only**. No Cloudflare account has been configured, no DNS records changed, no Tunnel deployed, and no Access policies applied.

The deployment stages are:

1. INF-CF-0 (this stage): architecture and documentation.
2. INF-CF-1 through INF-CF-7: see `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md`.

## Future Coolify Configuration

When the Tunnel is deployed (INF-CF-3), Coolify will run a service configured approximately as:

- **Image:** `cloudflare/cloudflared:latest`
- **Command:** `tunnel run --token ${CLOUDFLARE_TUNNEL_TOKEN}`
- **Environment variables:** sourced from encrypted Coolify environment.
- **Network:** Must be able to reach internal Coolify application services by hostname or container name.
- **Restart policy:** Always (to reconnect automatically after transient failures).

## Hostname Routing

All application hostnames route through the Tunnel. The Tunnel ingress rules (configured in Cloudflare Zero Trust) map each public or private hostname to the appropriate internal service.

| Hostname | Access | Notes |
|---|---|---|
| `app.mythosprod.xyz` | Public | WAF, rate limiting, application auth |
| `api.mythosprod.xyz` | Private or Conditional | Cloudflare Access if classified as private |
| `watch.mythosprod.xyz` | Private | Cloudflare Access required |
| `n8n.mythosprod.xyz` | Private | Cloudflare Access required |
| `coolify.mythosprod.xyz` | Private | Cloudflare Access required |
| `admin.mythosprod.xyz` | Private | Cloudflare Access required |
| `files.mythosprod.xyz` | Public/Private | R2 or Tunnel-backed |

**Unmatched routes must return HTTP 404.** The Tunnel ingress default catch-all action is 404.

## Cloudflare Access

All private hostnames must be protected by Cloudflare Access with **deny-by-default** policies before they become reachable. Access is configured during INF-CF-4.

Application-level authentication remains **mandatory** behind Cloudflare Access. Access is a defence-in-depth layer and does not replace app auth.

## References

- `docs/CLOUDFLARE_ARCHITECTURE.md` — Full architecture and design decisions.
- `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md` — Staged deployment plan.
- `cloudflared.env.example` — Environment variable template (no real values).

---

**Next stage:** INF-CF-1 — Cloudflare account and domain inventory