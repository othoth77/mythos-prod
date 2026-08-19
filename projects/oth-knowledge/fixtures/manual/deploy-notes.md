# Deployment notes (synthetic fixture)

All fixture content in this directory is synthetic and non-sensitive.

## Web server

The production web server uses nginx with a hardened vhost configuration.
Certificates are issued with certbot; always run a certbot dry-run before a
real certificate operation. Static assets are transferred with rsync where
available, otherwise scp.

## Rollback

Every deployment records the deployed commit hash and keeps the previous
release directory so a rollback is a single symlink switch followed by a
service reload.
