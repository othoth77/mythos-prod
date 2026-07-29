# Mythos Prod

Production management platform for Mythos clients (chess school). Pure PHP + Vanilla JS SPA with flat JSON file storage.

## Stack

- PHP (no framework)
- Vanilla JS (no build step)
- Flat JSON file storage under `appdata/`
- Google OAuth for authentication

## Production

Live at: `https://uthinachess.tn/0726/Prod/`
Server path: `/var/www/uthinachess/0726/Prod/`

## Local setup

1. Clone this repo
2. Copy `google_config.php.example` → `google_config.php` and fill in real Google OAuth credentials
3. Create the `appdata/` directory and restore data from a production backup
4. Serve with any PHP-capable server (e.g. `php -S localhost:8000`)

## Files excluded from Git

These files exist in production but are intentionally excluded:

| Path | Reason |
|------|--------|
| `google_config.php` | Contains real Google OAuth credentials |
| `ACCES.txt` | Contains plaintext access code |
| `appdata/` | Live client data (clients, invoices, OMs, etc.) |
| `documents/` | Uploaded client documents |
| `data/restore-*.js` | Data restoration snapshots |

## Deployment

Copy changed source files to the production server manually:

```bash
rsync -av --exclude='appdata/' --exclude='documents/' --exclude='google_config.php' --exclude='ACCES.txt' \
  /home/deploy/projects/mythos-prod/ deploy@server:/var/www/uthinachess/0726/Prod/
```

Do NOT run git inside `/var/www`. Never overwrite `appdata/` or `google_config.php` on the server.
