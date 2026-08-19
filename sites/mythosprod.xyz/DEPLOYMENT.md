# mythosprod.xyz — deployment runbook

**Status: BUILT, NOT DEPLOYED.** No apex vhost exists (O-003's recorded
state). Deployment requires host access this build session does not have —
the documented `deploy`-user privilege boundary (MOS-1.6/1.7). Everything
below is ready to execute the moment an operator with legitimate access
runs it.

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
