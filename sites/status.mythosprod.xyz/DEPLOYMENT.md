# status.mythosprod.xyz — operator deployment runbook

**Status: BUILT, NOT DEPLOYED.** Deployment requires host access this AI
session does not have (SSH network-blocked; HTTPS to the VPS egress-denied
— the documented VPS-PATH state). Everything below is ready to execute the
moment an operator with legitimate access runs it.

Goal: `https://status.mythosprod.xyz/` serves the Mythos Status Center
provisioning page with its own valid certificate, and **stops falling into
the default-vhost fallback that 301-redirects to `https://darhijama.tn/`**.

The fix is **strictly additive**: one new docroot, one new vhost, one new
certificate. **Do not modify, disable, or reorder any existing vhost —
in particular `/etc/nginx/sites-enabled/dar-hijama-app` — and do not touch
any DNS record.** The DNS record for `status.mythosprod.xyz`
(`A 51.68.226.211`) already exists and is correct.

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

If any preflight expectation fails, stop and re-diagnose — do not proceed
on a host whose state differs from
`docs/audits/STATUS_CENTER_ROUTING_DIAGNOSIS_2026-08-20.md`.

## 1. Copy the site

```bash
sudo mkdir -p /var/www/status.mythosprod.xyz
sudo rsync -av --delete \
  /srv/mythos/repository/sites/status.mythosprod.xyz/ \
  /var/www/status.mythosprod.xyz/ \
  --exclude DEPLOYMENT.md --exclude README.md
sudo chown -R www-data:www-data /var/www/status.mythosprod.xyz
```

(Adjust the source path to wherever the repository checkout lives on the
host; `DEPLOYMENT.md`/`README.md` are documentation, not site content.)

## 2. nginx vhost (additive)

`/etc/nginx/sites-available/status.mythosprod.xyz`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name status.mythosprod.xyz;

    root /var/www/status.mythosprod.xyz;
    index index.html;

    # Security headers
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    # CSP: fully self-contained page — no external origins, no scripts.
    add_header Content-Security-Policy "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; script-src 'none'; base-uri 'self'; form-action 'none'" always;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/status.mythosprod.xyz /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

An exact `server_name` match always beats the default-server fallback, so
this alone ends the darhijama.tn redirect for HTTP — with zero change to
any other site.

## 3. TLS certificate

Exactly the procedure MCC-1-VERIFY proved on this host (certbot extends
the vhost above with the :443 listener and HTTP→HTTPS redirect):

```bash
sudo certbot --nginx -d status.mythosprod.xyz
sudo nginx -t && sudo systemctl reload nginx
```

Until this step runs, HTTPS clients receive the host's default certificate
(SNI mismatch) — the certificate step is required, not optional.

## 4. Verification (required)

```bash
curl -I  https://status.mythosprod.xyz/
curl -IL https://status.mythosprod.xyz/
```

Pass criteria:

- Final response `200 OK`, served from `status.mythosprod.xyz`, valid TLS.
- **No response in either chain contains `darhijama.tn`** (no `Location:`
  header pointing there).
- `curl -sS https://status.mythosprod.xyz/ | grep -c "Status Center"` → `> 0`.

Regression checks (existing sites must be untouched):

```bash
curl -I https://darhijama.tn/            # still 200, TLS valid
curl -I https://uthinachess.tn/          # still 200
curl -I https://panel.mythosprod.xyz/    # still 302 → /login
```

## 5. Record the evidence

Append the executed commands and outputs (redact nothing — none are
secret) to `docs/audits/STATUS_CENTER_ROUTING_DIAGNOSIS_2026-08-20.md`
under a "Deployment executed" section, and update `docs/AI_HANDOVER.md`
(deployment status: DEPLOYED + smoke-test result), per AGENTS.md §15/§18.

## 6. Rollback

Static page, no state: `sudo rm
/etc/nginx/sites-enabled/status.mythosprod.xyz && sudo nginx -t && sudo
systemctl reload nginx`. (This returns the hostname to the default-vhost
fallback, i.e. the darhijama.tn redirect.) Certificate removal, if ever
wanted: `sudo certbot delete --cert-name status.mythosprod.xyz`.
