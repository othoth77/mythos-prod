# Deployment — status.mythosprod.xyz (operator runbook)

**Status: BUILT, NOT DEPLOYED.** Deployment requires host access AI
sessions do not have (SSH network-blocked; HTTPS to the VPS
egress-denied — the documented VPS-PATH state). Execute from the
owner's verified channel (Windows → `deploy@51.68.226.211`, SSH
ED25519; from Windows use `scp -r` or tar-over-ssh where this runbook
says rsync).

Goal: `https://status.mythosprod.xyz/` serves the MYTHOS Status Center
with its own valid certificate, and **stops falling into the
default-vhost fallback that 301-redirects to `https://darhijama.tn/`**
(root cause: no vhost carries this `server_name` — full diagnosis in
`docs/audits/STATUS_CENTER_ROUTING_DIAGNOSIS_2026-08-20.md`).

The fix is **strictly additive**: one new docroot, one new vhost, one
new certificate. **Do not modify, disable, or reorder any existing
vhost — in particular `/etc/nginx/sites-enabled/dar-hijama-app` — and
do not touch any DNS record.** The DNS record
(`status.mythosprod.xyz A 51.68.226.211`) already exists and is correct
(explicit record, no wildcard).

This surface loads its own same-origin JavaScript (CSP
`script-src 'self'` — no inline, no external code) and maps `/health`
to `health.json`.

## 0. Preflight (read-only, 1 minute)

```bash
# Confirm DNS still points at this host
dig +short status.mythosprod.xyz          # expect 51.68.226.211

# Confirm no vhost already claims the name
grep -rn "status.mythosprod.xyz" /etc/nginx/sites-enabled/ /etc/nginx/sites-available/   # expect no matches

# Record (for the evidence log) which server currently swallows unknown hosts
grep -rn "default_server" /etc/nginx/sites-enabled/ || echo "implicit default = first server block"

# Reproduce the fault before fixing it (from any machine)
curl -sSI  http://status.mythosprod.xyz/  | head -5    # expect 301 → https://darhijama.tn/
```

If any preflight expectation fails, stop and re-diagnose — do not
proceed on a host whose state differs from
`docs/audits/STATUS_CENTER_ROUTING_DIAGNOSIS_2026-08-20.md`.

## 1. Copy the site

```bash
sudo mkdir -p /var/www/status.mythosprod.xyz
sudo rsync -av --delete \
  <repo>/sites/status.mythosprod.xyz/ /var/www/status.mythosprod.xyz/ \
  --exclude DEPLOYMENT.md --exclude README.md
sudo chown -R www-data:www-data /var/www/status.mythosprod.xyz
```

(Adjust `<repo>` to wherever the repository checkout lives on the host,
e.g. `/srv/mythos/repository`.) Note: `data/`, `reviews/` and
`health.json` ARE site content — they are the data model the page
renders. Redeploy after every committed review.

## 2. nginx vhost (additive)

`/etc/nginx/sites-available/status.mythosprod.xyz` — pre-TLS form only;
certbot rewrites this file in place when the certificate is issued. Do
not hand-write the 443 block; let certbot own it so renewal keeps
working.

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name status.mythosprod.xyz;

    root /var/www/status.mythosprod.xyz;
    index index.html;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy no-referrer always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'none'" always;

    # Operational surface — not a public document.
    location = /robots.txt {
        add_header Content-Type text/plain;
        return 200 "User-agent: *\nDisallow: /\n";
    }

    # Health endpoint (allowlisted JSON written by the review engine).
    location = /health {
        default_type application/json;
        alias /var/www/status.mythosprod.xyz/health.json;
    }

    location /assets/fonts/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # Data must never be cached stale.
    location /data/ {
        add_header Cache-Control "no-cache";
    }

    location / { try_files $uri $uri/ =404; }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/status.mythosprod.xyz /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

An exact `server_name` match always beats the default-server fallback,
so this alone ends the darhijama.tn redirect for HTTP — with zero
change to any other site.

## 3. TLS certificate

Exactly the procedure MCC-1-VERIFY proved on this host (certbot extends
the vhost above with the :443 listener and HTTP→HTTPS redirect):

```bash
sudo certbot --nginx -d status.mythosprod.xyz
sudo nginx -t && sudo systemctl reload nginx
```

Until this step runs, HTTPS clients receive the host's default
certificate (SNI mismatch) — the certificate step is required, not
optional. (DNSSEC is active on mythosprod.xyz; no CAA constraint.)

## 4. Verification (required)

```bash
curl -I  https://status.mythosprod.xyz/
curl -IL https://status.mythosprod.xyz/
curl -sS https://status.mythosprod.xyz/health
curl -sS https://status.mythosprod.xyz/data/current.json | head -5
curl -sS https://status.mythosprod.xyz/robots.txt
curl -sSI https://status.mythosprod.xyz/assets/fonts/ibm-plex-sans-400-latin.woff2 | head -5
```

Pass criteria:

- Final response `200 OK`, served from `status.mythosprod.xyz`, valid TLS.
- **No response in either curl chain contains `darhijama.tn`** (no
  `Location:` header pointing there).
- `curl -sS https://status.mythosprod.xyz/ | grep -c "Status Center"` → `> 0`.
- `/health` returns the allowlisted JSON with a `review_id`.
- `sudo nginx -t` passes.

Regression checks (existing sites must be untouched):

```bash
curl -I https://darhijama.tn/            # still 200, TLS valid
curl -I https://uthinachess.tn/          # still 200
curl -I https://panel.mythosprod.xyz/    # still 302 → /login
```

Browser checks: review ID and main HEAD render in the header strip;
project matrix filters; a project row opens its drawer; the timeline
"Today" filter works; REVIEW NOW opens the engine drawer; keyboard tab
order reaches every control with a visible focus ring; no console
errors.

## 5. Record the evidence

Append the executed commands and outputs (none are secret) to
`docs/audits/STATUS_CENTER_ROUTING_DIAGNOSIS_2026-08-20.md` under a
"Deployment executed" section, and update `docs/AI_HANDOVER.md`
(deployment status: DEPLOYED + smoke-test result), per AGENTS.md
§15/§18. Then run a new Status Center review
(`node projects/status-center/bin/review.js`) so the dashboard itself
records its deployment with evidence.

## 6. Rollback

Static site, no state: `sudo rm
/etc/nginx/sites-enabled/status.mythosprod.xyz && sudo nginx -t && sudo
systemctl reload nginx`. (This returns the hostname to the
default-vhost fallback, i.e. the darhijama.tn redirect.) Certificate
removal, if ever wanted: `sudo certbot delete --cert-name
status.mythosprod.xyz`. No database, no migrations — nothing else to
undo.
