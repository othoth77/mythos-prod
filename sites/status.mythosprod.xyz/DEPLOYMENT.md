# Deployment — status.mythosprod.xyz

Operator runbook. Follows the `sites/mythosprod.xyz/DEPLOYMENT.md`
pattern exactly, with two deltas: this surface loads its own same-origin
JavaScript (so the CSP carries `script-src 'self'`, still no inline and
no external code), and `/health` maps to `health.json`.

Prerequisites (owner):

- DNS A record `status.mythosprod.xyz → 51.68.226.211` at OVH.
  There is **no wildcard** on `mythosprod.xyz`; the record must be
  created explicitly. Verify on the host: `getent hosts status.mythosprod.xyz`.
- Host access: this is executed from the owner's verified channel
  (Windows → `deploy@51.68.226.211`, SSH ED25519) — AI sessions have no
  VPS path (docs/DEPLOYMENT_READINESS.md). From Windows use `scp -r` or
  tar-over-ssh where this runbook says rsync.

## 1. Copy the site

```bash
sudo mkdir -p /var/www/status.mythosprod.xyz
rsync -av --delete \
  <repo>/sites/status.mythosprod.xyz/ /var/www/status.mythosprod.xyz/ \
  --exclude DEPLOYMENT.md --exclude README.md
sudo chown -R www-data:www-data /var/www/status.mythosprod.xyz
```

Note: `data/`, `reviews/` and `health.json` ARE site content — they are
the data model the page renders. Redeploy after every committed review.

## 2. nginx vhost

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

## 3. TLS

After DNS resolves on the host:

```bash
sudo certbot --nginx -d status.mythosprod.xyz
```

(DNSSEC is active on mythosprod.xyz; no CAA constraint exists.)

## 4. Smoke test

```bash
curl -sSI https://status.mythosprod.xyz/ | head -20        # 200 + security headers
curl -sS  https://status.mythosprod.xyz/health              # allowlisted JSON, review_id present
curl -sS  https://status.mythosprod.xyz/data/current.json | head -5
curl -sS  https://status.mythosprod.xyz/robots.txt          # Disallow: /
curl -sSI https://status.mythosprod.xyz/assets/fonts/ibm-plex-sans-400-latin.woff2 | head -5
```

Browser checks: review ID and main HEAD render in the header strip;
project matrix filters; a project row opens its drawer; the timeline
"Today" filter shows today's milestones; REVIEW NOW opens the engine
drawer; keyboard tab order reaches every control with a visible focus
ring; no console errors.

## 5. Rollback

Remove the symlink from `sites-enabled`, reload nginx. The site is
static — no state, no database, no migrations; nothing else to undo.
