# mythosprod.xyz — deployment runbook

**Status: DEPLOYED 2026-08-22.** Live at https://mythosprod.xyz and
https://www.mythosprod.xyz, TLS issued, HTTP redirected to HTTPS, and the
`hub-apex` Status Center probe reports LIVE. BLOCKER-HUB-DNS is cleared.

What was actually run on the host is recorded in §6 — it differs from the
steps below only in the source path (this checkout lives at
`/home/deploy/projects/mythos-prod`, not `/srv/mythos/repository`) and in
the certbot invocation. The generic procedure below is retained as the
rebuild recipe.

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

The commands actually executed, in order. `nginx -t` passed before every
reload; no unrelated vhost was touched.

```bash
# content — checkout path on this host; docs are not site content
sudo mkdir -p /var/www/mythosprod.xyz
sudo cp -a /home/deploy/projects/mythos-prod/sites/mythosprod.xyz/{index.html,robots.txt,sitemap.xml} \
           /var/www/mythosprod.xyz/
sudo cp -a /home/deploy/projects/mythos-prod/sites/mythosprod.xyz/assets /var/www/mythosprod.xyz/
sudo chown -R www-data:www-data /var/www/mythosprod.xyz

# vhost — §2 verbatim, written to /etc/nginx/sites-available/mythosprod.xyz
sudo ln -sfn /etc/nginx/sites-available/mythosprod.xyz /etc/nginx/sites-enabled/mythosprod.xyz
sudo nginx -t && sudo systemctl reload nginx

# TLS — DNS for apex and www already pointed at 51.68.226.211
sudo certbot --nginx -d mythosprod.xyz -d www.mythosprod.xyz \
  --non-interactive --agree-tos --register-unsafely-without-email --redirect
```

certbot rewrote the vhost in place, adding the `listen 443 ssl` server, the
certificate paths under `/etc/letsencrypt/live/mythosprod.xyz/`, and the
port-80 → HTTPS redirect. **The file on disk is therefore no longer §2
verbatim** — treat `/etc/nginx/sites-available/mythosprod.xyz` as the live
copy and §2 as the pre-TLS source.

Verified after deployment: apex and www both 200 over HTTPS; port 80 → 301
to HTTPS on both names; certificate `CN=mythosprod.xyz`, SAN covers
`mythosprod.xyz` and `www.mythosprod.xyz`, expires 2026-11-20; all five
security headers present; `assets/fonts/*.woff2` served 200 with the
immutable cache header; `robots.txt` carries the sitemap line.

### Content note

`index.html` gained two sections at deployment time — `#plateforme` (the
platform service directory: OS Console, Command Center, Status Center, and
the ERP/Production modules still in preparation) and `#etat` (link to the
Status Center, plus the single access point that unified sign-in will
attach to). Both compose only from classes and tokens the page already
had: no new CSS, no JavaScript — the CSP sets `script-src 'none'` and the
page must keep working under it.
