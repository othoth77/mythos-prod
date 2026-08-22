# mythosprod.xyz — deployment runbook

**Status: DEPLOYED 2026-08-22 — Mythos Hub Dashboard.** Live at
https://mythosprod.xyz and https://www.mythosprod.xyz. BLOCKER-HUB-DNS is
cleared.

The apex now serves the **Hub Dashboard**, not the earlier static brand
page: a service directory with measured state, an infrastructure panel, an
(inert) AI area, and the ecosystem sections kept below. §6 records what was
actually run and what changed in the vhost; §1–§4 remain the generic
recipe.

The site is fully static and self-contained: no build step, no runtime, no
external requests (all fonts self-hosted in `assets/fonts/`). Serving it is
one nginx vhost and one certificate.

## 1. Copy the site

```bash
sudo mkdir -p /var/www/mythosprod.xyz
sudo rsync -av --delete \
  /srv/mythos/repository/sites/mythosprod.xyz/ \
  /var/www/mythosprod.xyz/ \
  --exclude DEPLOYMENT.md --exclude README.md
sudo chown -R www-data:www-data /var/www/mythosprod.xyz
```

(Adjust the source path to wherever the repository checkout lives on the
host; `DEPLOYMENT.md`/`README.md` are documentation, not site content.)

## 2. nginx vhost

`/etc/nginx/sites-available/mythosprod.xyz`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name mythosprod.xyz www.mythosprod.xyz;

    root /var/www/mythosprod.xyz;
    index index.html;

    # Security headers
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    # CSP: fully self-contained site — no external origins needed.
    add_header Content-Security-Policy "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; script-src 'none'; base-uri 'self'; form-action 'none'" always;

    location / {
        try_files $uri $uri/ =404;
    }

    location /assets/fonts/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/mythosprod.xyz /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Note: `style-src 'unsafe-inline'` is required by the page's single inline
`<style>` block. If a stricter CSP is wanted later, externalise the styles
to a file and drop it.

## 3. DNS + TLS

DNS: an `A` record for `mythosprod.xyz` (and `www`) → the VPS IP
(51.68.226.211 per the recorded host state). DNS changes are an
owner-approval action (AGENTS.md §25.3 precedent from MCC-1).

Then, exactly the procedure MCC-1-VERIFY proved on this host:

```bash
sudo certbot --nginx -d mythosprod.xyz -d www.mythosprod.xyz
```

## 4. Post-deploy smoke test

```bash
curl -sSI https://mythosprod.xyz/ | head -20        # 200, security headers present
curl -sS https://mythosprod.xyz/ | grep -c "MYTHOS" # > 0
curl -sSI https://mythosprod.xyz/assets/fonts/archivo-expanded-600-latin.woff2 | head -3  # 200
curl -sS https://mythosprod.xyz/robots.txt          # sitemap line present
```

Open in a real browser: wordmark renders (SVG inline), fonts are Archivo
Expanded/Plex (not fallback), the five live project links resolve, no
console errors, keyboard tab order reaches every link, focus ring visible.

## 5. Rollback

The site is static: rollback = remove the vhost symlink and reload nginx
(`sudo rm /etc/nginx/sites-enabled/mythosprod.xyz && sudo nginx -t && sudo
systemctl reload nginx`), or re-rsync a previous checkout. No state, no
database, no migrations — nothing else to undo.

## 6. As-deployed record (2026-08-22, this host)

Source path on this host is `/home/deploy/projects/mythos-prod`, not
`/srv/mythos/repository`. Content is copied without `--delete` because the
target is created empty; `DEPLOYMENT.md`/`README.md` are not site content.

```bash
sudo mkdir -p /var/www/mythosprod.xyz
sudo cp -a <checkout>/sites/mythosprod.xyz/{index.html,robots.txt,sitemap.xml,health.json} /var/www/mythosprod.xyz/
sudo cp -a <checkout>/sites/mythosprod.xyz/assets /var/www/mythosprod.xyz/
sudo chown -R www-data:www-data /var/www/mythosprod.xyz
sudo ln -sfn /etc/nginx/sites-available/mythosprod.xyz /etc/nginx/sites-enabled/mythosprod.xyz
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d mythosprod.xyz -d www.mythosprod.xyz \
  --non-interactive --agree-tos --register-unsafely-without-email --redirect
```

certbot rewrites the vhost in place (adds the `listen 443 ssl` server, the
cert paths, and the port-80 redirect), so **the file on disk is the live
copy and §2 is only the pre-TLS source.**

### Vhost changes the dashboard requires

Two additions beyond §2, both same-origin:

```nginx
# Live service state, read straight off the Status Center monitor output.
# The Hub does not run a second monitor.
location = /api/status.json {
    alias /var/www/status.mythosprod.xyz/data/live-status.json;
    default_type application/json;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options nosniff always;
}
location = /health.json {
    default_type application/json;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options nosniff always;
}
```

`add_header` inside a `location` replaces the inherited set, which is why
the headers that matter for a JSON body are restated in each block.

And the CSP moves `script-src` and `connect-src` from `'none'` to
`'self'` — the dashboard loads one same-origin script and makes two
same-origin fetches. **`'unsafe-inline'` is not granted to scripts**: there
are no inline `<script>` blocks and no `on*=` handlers, and the page must
stay that way.

### Deploy stamp

`health.json` ships with `repository_head` and `deployed_at` as `null` and
is stamped in the **served copy** at deploy time:

```bash
HEAD_SHA=$(git -C <checkout> rev-parse HEAD)
sudo python3 - <<'EOF'
import json,datetime
p='/var/www/mythosprod.xyz/health.json'
d=json.load(open(p)); d['repository_head']='<HEAD_SHA>'
d['deployed_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
json.dump(d,open(p,'w'),indent=2)
EOF
```

The repository copy stays `null` on purpose — a committed timestamp would
be a claim the repository cannot keep true.

### Degradation contract

The page is complete and readable with JavaScript disabled or
`/api/status.json` failing: every status surface ships a truthful
placeholder and `dashboard.js` only replaces placeholders with measured
values. A fetch failure renders "Indisponible", never green.

## 7. Monitoring

Two probes cover the entry point in
`projects/status-center/monitor/probes.json`:

- `hub-apex` — `https://mythosprod.xyz/` expects 200. Unchanged; it stopped
  reporting DOWN because the apex is served, not because it was relaxed.
- `hub-dashboard-health` — `https://mythosprod.xyz/health.json` expects 200
  and a body containing `"application"`.
