# ops/lifecycle — Execution Lifecycle host pieces

Design and operation: `docs/MYTHOS_EXECUTION_LIFECYCLE.md`. Nothing here is installed by an agent.

| File | Role |
|---|---|
| `claude-lifecycle-hook.js` | Claude Code hook (SessionStart, UserPromptSubmit, Stop, SubagentStop, TaskCompleted, Notification, PreCompact, SessionEnd). Converts the hook payload into one lifecycle event file in the registry inbox (VPS) or the PC agent spool (PC). No network, no transcript read, always exits 0, prints nothing. Node core only — safe to copy to `/usr/local/lib` as root and to a PC. |
| `claude-settings-hooks.example.json` | The `hooks` block to merge into the Claude settings of each account that runs sessions. |
| `install-lifecycle-hooks.sh` | **Owner action, root.** Copies the hook to `/usr/local/lib/mythos-lifecycle/`, creates the deploy-owned registry (`~deploy/mythos-ai-executor/lifecycle`, inbox 0770) and merges the hooks into `/root/.claude/settings.json` and `/home/deploy/.claude/settings.json` (backups kept; `unwire.js` removes only our entries). |
| `mythos-pc-agent.js` | Reference **PC agent**: relays the PC spool to `POST /lifecycle/events` (bearer + HMAC), heartbeats open sessions, confirms `PROCESS_GONE` after `SessionEnd`, polls its outbox and honours close requests only under its own `allow_close` / `allow_force` config, graceful signal only. |

## VPS

```bash
sudo bash ops/lifecycle/install-lifecycle-hooks.sh        # hooks + registry dirs
sudo bash ops/session-guard/install-session-guard.sh      # runner + runtime-vps.js sibling + /var/lib/mythos/lifecycle
node projects/mythos-ai-executor/bin/mythos-lifecycle status
touch /home/deploy/mythos-ai-executor/lifecycle/cleanup.enabled   # enable cleanup (rm = rollback)
```

Switches: `MYTHOS_LIFECYCLE_HOOK=off` (hook), `MYTHOS_LIFECYCLE_CLEANUP=off` (cleanup kill switch),
`MYTHOS_LIFECYCLE_HOME`, `MYTHOS_LIFECYCLE_SNAPSHOT`, `MYTHOS_LIFECYCLE_IDLE_SECONDS`, `MYTHOS_LIFECYCLE_GRACE_SECONDS`;
`<registry>/policy.json` for the rest (`force_kill_enabled` lives only there).

## PC

1. Copy `claude-lifecycle-hook.js` and `mythos-pc-agent.js` to the PC; wire the hook into `~/.claude/settings.json`
   with the environment `MYTHOS_LIFECYCLE_LOCATION=PC` and `MYTHOS_LIFECYCLE_SPOOL=<agent spool>`.
2. `~/.mythos-pc-agent/config.json`: `{ "endpoint": "http://127.0.0.1:8130", "host": "owner-pc", "allow_close": false }`,
   `~/.mythos-pc-agent/token` (executor bearer, 0600), `~/.mythos-pc-agent/secret` (same value as the VPS file named by
   `MYTHOS_LIFECYCLE_RELAY_SECRET_FILE`, default `~deploy/.config/mythos-ai-executor/lifecycle-relay.secret`).
3. Reach the executor API over an SSH tunnel (`ssh -L 8130:127.0.0.1:8130 …`). Run `node mythos-pc-agent.js`.
4. Only after observing: `allow_close: true`. `allow_force` should stay `false`.
