#!/usr/bin/env bash
# =====================================================
# MYTHOS Execution Lifecycle — VPS installer (OWNER ACTION, run as root)
# ops/lifecycle/install-lifecycle-hooks.sh
#
# Installs the Claude Code lifecycle hook for the accounts that run Claude
# sessions on this host, and prepares the registry inbox so root-owned
# Desktop Remote sessions can hand their events to the deploy-owned
# registry. Idempotent. Nothing here closes a session or enables cleanup.
#
#   1. copy ops/lifecycle/claude-lifecycle-hook.js → /usr/local/lib/mythos-lifecycle/ (root:root 0755)
#      (root must never execute code out of the deploy-writable checkout)
#   2. create <executor home>/lifecycle/{inbox,outbox,...} owned by deploy (0700, inbox 0770)
#   3. merge the hook wiring into /root/.claude/settings.json and
#      /home/deploy/.claude/settings.json (backup kept; existing hooks preserved)
#
# Rollback:
#   node /usr/local/lib/mythos-lifecycle/unwire.js   (removes only our entries), or
#   restore the .bak-<ts> copies printed below.
#   The hook can be silenced without touching settings: MYTHOS_LIFECYCLE_HOOK=off.
# =====================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB=/usr/local/lib/mythos-lifecycle
EXEC_HOME="${MYTHOS_EXECUTOR_HOME:-/home/deploy/mythos-ai-executor}"
REG="${MYTHOS_LIFECYCLE_HOME:-$EXEC_HOME/lifecycle}"
DEPLOY_USER="${MYTHOS_DEPLOY_USER:-deploy}"

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
log() { printf '[lifecycle-install] %s\n' "$*"; }

# 1. root-owned copies
install -d -m 0755 "$LIB"
install -m 0755 -o root -g root "$REPO_DIR/ops/lifecycle/claude-lifecycle-hook.js" "$LIB/claude-lifecycle-hook.js"
install -m 0644 -o root -g root "$REPO_DIR/ops/lifecycle/claude-settings-hooks.example.json" "$LIB/hooks.json"
log "hook installed at $LIB/claude-lifecycle-hook.js"

# 2. registry directories (deploy-owned; inbox accepts root-written files handed over by chown)
install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$REG" "$REG/executions" "$REG/sessions" "$REG/outbox" "$REG/quarantine"
install -d -m 0770 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$REG/inbox"
log "registry at $REG (inbox 0770 $DEPLOY_USER)"

# 3. wire hooks (merge, never overwrite)
cat > "$LIB/wire.js" <<'EOF'
'use strict';
var fs = require('fs');
var file = process.argv[2];
var hooks = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).hooks;
var settings = {};
try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { settings = {}; }
settings.hooks = settings.hooks || {};
var changed = false;
Object.keys(hooks).forEach(function (ev) {
  var list = settings.hooks[ev] = settings.hooks[ev] || [];
  var ours = JSON.stringify(hooks[ev][0]);
  if (!list.some(function (h) { return JSON.stringify(h) === ours; })) { list.push(hooks[ev][0]); changed = true; }
});
if (changed) {
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak-' + Date.now());
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}
console.log((changed ? 'wired ' : 'already wired ') + file);
EOF
cat > "$LIB/unwire.js" <<'EOF'
'use strict';
var fs = require('fs');
[ '/root/.claude/settings.json', '/home/deploy/.claude/settings.json' ].forEach(function (file) {
  var settings; try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return; }
  if (!settings.hooks) return;
  var changed = false;
  Object.keys(settings.hooks).forEach(function (ev) {
    var before = settings.hooks[ev].length;
    settings.hooks[ev] = settings.hooks[ev].filter(function (h) { return JSON.stringify(h).indexOf('mythos-lifecycle/claude-lifecycle-hook.js') < 0; });
    if (!settings.hooks[ev].length) delete settings.hooks[ev];
    if (settings.hooks[ev] === undefined || settings.hooks[ev].length !== before) changed = true;
  });
  if (changed) { fs.copyFileSync(file, file + '.bak-' + Date.now()); fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n'); console.log('unwired ' + file); }
});
EOF
for acct in root "$DEPLOY_USER"; do
  home=$(getent passwd "$acct" | cut -d: -f6)
  [ -n "$home" ] || continue
  install -d -m 0755 -o "$acct" -g "$acct" "$home/.claude"
  node "$LIB/wire.js" "$home/.claude/settings.json" "$LIB/hooks.json"
  chown "$acct:$acct" "$home/.claude/settings.json"
done
log "done. Sessions started from now on report SessionStart/Stop/TaskCompleted/SessionEnd into $REG/inbox."
log "Cleanup stays OBSERVE-only until: touch $REG/cleanup.enabled  (rollback: rm it)"
