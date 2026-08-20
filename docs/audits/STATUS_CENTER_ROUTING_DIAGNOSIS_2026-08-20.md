# status.mythosprod.xyz → darhijama.tn — routing diagnosis (2026-08-20)

**Verdict: the redirect originates at the ORIGIN VPS (51.68.226.211), in
the nginx default-vhost fallback. DNS is correct. Cloudflare is not in the
path. The Mythos Status Center is NOT deployed — no dedicated vhost, no
certificate, and no Status Center site content exists anywhere in this
repository.**

This is the same, already-documented failure mode recorded for the apex in
`docs/CLOUDFLARE_DOMAIN_INVENTORY.md` (§5, mythosprod.xyz: "HTTP `301` →
`https://darhijama.tn/`… served as the apparent default vhost on the
shared origin IP"), now simply exercised by a new hostname.

## 1. Evidence, layer by layer

Observation date: 2026-08-20, from this AI session's isolated remote
container. Live-HTTP items marked ⚠ could not be re-executed from here
(organization egress policy denies HTTPS to these hosts — CONNECT 403;
same access state recorded by the VPS-PATH stage, 2026-08-20) and rest on
the committed 2026-08 inventory/audit evidence plus DNS observed today.

| # | Layer | Finding | Basis |
|---|-------|---------|-------|
| 1 | DNS record | `status.mythosprod.xyz` → `A 51.68.226.211` (the shared OVH VPS). **Explicit record, not a wildcard**: `nonexistent-zz9.mythosprod.xyz` returns NXDOMAIN while `status.`, `panel.`, `coolify.` all resolve to the same IP. DNS is therefore CORRECT for the intended routing. | Resolved live today |
| 2 | Cloudflare | NOT in the path. `mythosprod.xyz` uses OVH authoritative nameservers (`ns109.ovh.net`/`dns109.ovh.net`); the record resolves directly to the OVH origin IP, not to Cloudflare anycast. The Cloudflare migration (INF-CF-*) is a documented plan, not live. | `docs/CLOUDFLARE_DOMAIN_INVENTORY.md` §5; live IP today |
| 3 | VPS routing | `51.68.226.211` serves six production domains behind one nginx on :80/:443 (uthinachess.tn, darhijama.tn, n8n.ssangyong.autos, panel/coolify.mythosprod.xyz, …). | `docs/audits/VPS_SERVICE_HEALTH_AUDIT_2026-08-10.md` |
| 4 | Web server / vhosts | nginx (host-native). `/etc/nginx/sites-enabled/dar-hijama-app` proxies `server_name darhijama.tn www.darhijama.tn` → `127.0.0.1:18081`. **No vhost exists for `status.mythosprod.xyz`** (none exists even for the apex `mythosprod.xyz`). | ⚠ VPS audit 2026-08-10 + domain inventory |
| 5 | server_name match | A request for `status.mythosprod.xyz` matches **no** `server_name`, so nginx hands it to the **default server** for the listener. On this host the default-vhost path demonstrably answers unknown hosts with `301 → https://darhijama.tn/` (verified for apex + www in the inventory). | ⚠ `docs/CLOUDFLARE_DOMAIN_INVENTORY.md` §5 |
| 6 | Redirect rule | The `301 → https://darhijama.tn/` is thus the default-server fallback (either an explicit/implicit `default_server` block or the Dar Hijama app answering foreign Host headers with its canonical-URL redirect — distinguishing the two takes one on-host grep, see runbook §0). It is NOT a rule targeting `status.` specifically. | ⚠ inventory §5 + audit |
| 7 | Deployment directory | No Status Center content exists on the VPS or in this repository. `sites/` contained only `mythosprod.xyz` (itself BUILT, NOT DEPLOYED). No reference to `status.mythosprod.xyz` or "Status Center" existed anywhere in the repo before this stage. | repo-wide search today |
| 8 | DarHijama config | Healthy and untouched: Stack A (manual compose, port 18081) is the live site; its vhost only claims `darhijama.tn`/`www`. Dar Hijama is the *destination* of the fallback, not the cause — **no DarHijama change is needed or proposed**. | VPS audit 2026-08-10 |
| 9 | SSL certificate | No certificate exists for `status.mythosprod.xyz`; TLS handshakes fall back to the default certificate (SNI mismatch — same `SEC_E_WRONG_PRINCIPAL` class recorded for the apex). The browser reaches darhijama.tn after the redirect on the mismatched/HTTP path. | ⚠ inventory §5 (apex precedent) |
| 10 | Status Center deployment config | **MISSING ENTIRELY — this is the root gap.** The exact missing step: no Status Center artifact was ever built or deployed; therefore no vhost, no cert, no docroot. DNS was created ahead of the deployment. | repo evidence |

## 2. Causal chain (exact)

```text
Browser → status.mythosprod.xyz
  → DNS (OVH): A 51.68.226.211 ........................... CORRECT
  → Cloudflare: not in path .............................. N/A
  → VPS nginx :443/:80: no server_name matches ........... ROOT CAUSE (missing vhost)
  → default-server fallback: 301 https://darhijama.tn/ ... the observed redirect
  → darhijama.tn (its own correct vhost, 200) ............ innocent destination
```

## 3. Fix (additive only — nothing existing is modified)

Operator runbook: `sites/status.mythosprod.xyz/DEPLOYMENT.md`. Summary:

1. Copy `sites/status.mythosprod.xyz/` (provisioning page) to
   `/var/www/status.mythosprod.xyz`.
2. Add ONE new nginx vhost with `server_name status.mythosprod.xyz;`
   (exact-match beats the default-server fallback; no existing vhost,
   including `dar-hijama-app`, is touched).
3. Issue the certificate: `sudo certbot --nginx -d status.mythosprod.xyz`
   (the MCC-1-VERIFY-proven procedure on this host).
4. Verify: `curl -I https://status.mythosprod.xyz/` and
   `curl -IL https://status.mythosprod.xyz/` — final response must be
   `200` on `status.mythosprod.xyz` with **no** `darhijama.tn` anywhere in
   the chain; then `curl -I https://darhijama.tn/` must still be `200`.

This session could not execute the fix itself: no approved access path to
the VPS exists from the AI environment (SSH network-blocked; HTTPS to the
VPS egress-denied — both re-verified this session; see the VPS-PATH stage
record). Nothing here is a fabricated deployment: the repo state is
**BUILT (provisioning page + runbook), NOT DEPLOYED**.

## 4. What the "Status Center" still needs (beyond routing)

The provisioning page only reclaims the hostname honestly (no invented
status data — O-A2 discipline). An actual Status Center (live service
status/uptime) is an undesigned, unbuilt product: it needs an owner
decision on scope, a design pass under the A-020 architecture, and its own
stage before it can replace the provisioning page in the same docroot.
