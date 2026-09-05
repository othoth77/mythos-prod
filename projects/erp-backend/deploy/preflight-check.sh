#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Mythos ERP backend — HOST prerequisite audit (§3)
# projects/erp-backend/deploy/preflight-check.sh
#
# Run this ON THE HOST before deploying. It only INSPECTS — it changes
# nothing. Every line is a gate the deployment depends on; a FAIL must be
# resolved before proceeding. "Do not assume. Verify."
# ══════════════════════════════════════════════════════════════════════
set -u
PASS=0; WARN=0; FAILN=0
ok(){   PASS=$((PASS+1));   printf '  \033[32mOK\033[0m   %s\n' "$1"; }
warn(){ WARN=$((WARN+1));   printf '  \033[33mWARN\033[0m %s\n' "$1"; }
bad(){  FAILN=$((FAILN+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
have(){ command -v "$1" >/dev/null 2>&1; }

echo "== PHP =="
if have php; then
  V=$(php -r 'echo PHP_VERSION;')
  php -r 'exit(version_compare(PHP_VERSION,"8.1.0",">=")?0:1);' && ok "php $V (>= 8.1)" || bad "php $V is < 8.1"
  for ext in pdo pdo_sqlite; do
    php -r "exit(extension_loaded('$ext')?0:1);" && ok "ext $ext" || bad "missing php ext: $ext"
  done
  # The fileinfo EXTENSION is named 'fileinfo'; the class is 'finfo'.
  php -r 'exit((extension_loaded("fileinfo")||class_exists("finfo"))?0:1);' && ok "ext fileinfo (finfo)" || bad "missing php ext: fileinfo (finfo)"
  php -r 'exit(defined("PASSWORD_ARGON2ID")?0:1);' && ok "argon2id available" || bad "argon2id not available (need libargon2)"
  # MySQL path is optional; only warn.
  php -r 'exit(extension_loaded("pdo_mysql")?0:1);' && ok "ext pdo_mysql (MariaDB option)" || warn "no pdo_mysql (fine if using sqlite)"
else bad "php not found"; fi

echo "== PHP-FPM / nginx =="
have php-fpm8.4 && ok "php-fpm8.4 present" || { have php-fpm && ok "php-fpm present" || warn "php-fpm binary not found by name (check the host's FPM package)"; }
ls /run/php/php*-fpm.sock >/dev/null 2>&1 && ok "an FPM socket exists in /run/php" || warn "no /run/php/php*-fpm.sock (adjust fastcgi_pass in the vhost)"
have nginx && ok "nginx present" || bad "nginx not found"
have nginx && { nginx -t >/dev/null 2>&1 && ok "current nginx config valid" || warn "nginx -t not clean right now (inspect before reload)"; }

echo "== TLS / systemd / tooling =="
have certbot && ok "certbot present" || warn "certbot not found (needed to issue TLS)"
have systemctl && ok "systemd present" || warn "systemd not found (timers/units)"
have sqlite3 && ok "sqlite3 CLI present" || warn "sqlite3 CLI not found (optional; PHP PDO is what the app uses)"
have curl && ok "curl present" || bad "curl not found (needed by the verify gate)"

echo "== Filesystem / disk =="
AVAIL=$(df -Pk / | awk 'NR==2{print int($4/1024)}')
[ "${AVAIL:-0}" -ge 500 ] && ok "root free space ${AVAIL} MiB (>= 500)" || warn "low free space: ${AVAIL} MiB"
for d in /var/www /var/lib; do [ -d "$d" ] && ok "$d exists" || warn "$d missing (create during deploy)"; done

echo "== Existing state (do not disturb) =="
[ -f /etc/nginx/sites-available/erp.mythosprod.xyz ] && warn "a static erp vhost exists — keep it until cutover (§1)" || ok "no conflicting erp vhost yet"
[ -d /var/www/erp.mythosprod.xyz ] && warn "static erp docroot present — leave it until cutover" || ok "no static erp docroot"
[ -d ops/backup ] || [ -d /home/deploy/mythos-backups ] && ok "existing backup tooling detected (reuse it, §16)" || warn "existing backup tooling not detected here"

echo
echo "PREFLIGHT: $PASS ok, $WARN warn, $FAILN fail"
[ "$FAILN" -eq 0 ] && echo "-> prerequisites satisfied (resolve any WARN as appropriate)" || echo "-> RESOLVE FAILS before deploying"
exit $([ "$FAILN" -eq 0 ] && echo 0 || echo 1)
