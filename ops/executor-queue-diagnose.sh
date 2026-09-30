#!/usr/bin/env bash
# =====================================================
# ops/executor-queue-diagnose.sh — why is an executor task still QUEUED?
#
# Owner-run on the VPS as `deploy` (the executor's own user). Answers the
# one question the console cannot: which link between "Start now" and a
# RUNNING task is broken. Written for t-20260930120308-fjw22c, which sat
# QUEUED at 0/5 running while the Status Center showed load 304 on 4 CPUs
# and swap 100% — and the Status Center has no probe for the executor
# daemon itself, so "all LIVE" said nothing about it.
#
#   bash ops/executor-queue-diagnose.sh <task-id>                    read-only
#   bash ops/executor-queue-diagnose.sh <task-id> --restart-if-hung  see below
#
# READ-ONLY by default: the official CLI (mythos-ai-executor status/list),
# the unauthenticated GET /health, the guard's state file, /proc, the user
# journal and the task's own events.log. No token is read. Nothing is written.
#
# --restart-if-hung restarts mythos-ai-executor ONLY when BOTH hold:
#   - GET /health failed to answer twice, 20 s apart (the daemon is hung,
#     not merely slow), and
#   - no task is RUNNING in the store (a restart would not cut a live run).
# It never restarts because of memory pressure: a Resource Guard deferral
# is the guard doing its job, and the fix is freeing memory, not bouncing
# the executor. It never touches thresholds, never kills a process, never
# changes a task. mythos-ai-executor is a HostOps protected unit, so this
# flag is an owner action by construction.
# =====================================================
set -uo pipefail

TASK_ID="${1:-}"
ACTION="${2:-}"
case "$TASK_ID" in
  t-[0-9]*-[a-z0-9]*) ;;
  *) echo "usage: $0 <task-id> [--restart-if-hung]" >&2; exit 2 ;;
esac
case "$ACTION" in ''|--restart-if-hung) ;; *) echo "unknown option: $ACTION" >&2; exit 2 ;; esac
[ "$(id -u)" -ne 0 ] || { echo "refusing to run as root: run as the executor's user (deploy)" >&2; exit 2; }

CHECKOUT="${MYTHOS_CHECKOUT:-$HOME/projects/mythos-prod}"
STORE="${MYTHOS_EXECUTOR_HOME:-$HOME/mythos-ai-executor}"
PORT="${MYTHOS_EXECUTOR_PORT:-8130}"
BIN="$CHECKOUT/projects/mythos-ai-executor/bin"
UNIT=mythos-ai-executor.service
TASK_DIR="$STORE/tasks/$TASK_ID"

section() { printf '\n=== %s\n' "$1"; }
health() { curl -sS -m 20 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health" 2>/dev/null || true; }

section "1. identity"
date -u
echo "user:       $(id -un)"
echo "checkout:   $(git -C "$CHECKOUT" rev-parse --short HEAD 2>/dev/null) ($(git -C "$CHECKOUT" branch --show-current 2>/dev/null))"
echo "origin/main $(git -C "$CHECKOUT" rev-parse --short origin/main 2>/dev/null) (last fetched copy; not fetched here)"

section "2. executor service"
systemctl --user show "$UNIT" -p ActiveState -p SubState -p MainPID -p ActiveEnterTimestamp -p NRestarts 2>&1
MAINPID="$(systemctl --user show "$UNIT" -p MainPID --value 2>/dev/null || echo 0)"
if [ "${MAINPID:-0}" -gt 0 ] 2>/dev/null; then
  ps -o pid,stat,etime,pcpu,rss,wchan:20,args -p "$MAINPID" 2>/dev/null | cut -c1-160
fi
H1="$(health)"
echo "GET /health: http=${H1:-none}"

section "3. task (official CLI)"
node "$BIN/mythos-ai-executor" status "$TASK_ID" 2>&1 | node -e '
  var s = ""; process.stdin.on("data", function (d) { s += d; }).on("end", function () {
    try {
      var j = JSON.parse(s), st = j.status || j;
      ["status","effective","next_action","last_error","pid","execution_id","retry_count","created_at","updated_at","started_at"]
        .forEach(function (k) { var v = k in st ? st[k] : j[k]; if (v !== undefined) console.log(k + ": " + JSON.stringify(v)); });
    } catch (e) { process.stdout.write(s.slice(0, 2000)); }
  });'
# The task contract lives in task.json; `status` does not print it.
node -e '
  try {
    var t = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    ["provider","model","execution_profile","timeout_seconds","max_retries","requested_by","mode","expected_delivery","working_directory"]
      .forEach(function (k) { console.log("task." + k + ": " + JSON.stringify(t[k])); });
  } catch (e) { console.log("task.json unreadable: " + e.message); }' "$TASK_DIR/task.json"
echo "--- events.log (last 15)"
tail -n 15 "$TASK_DIR/events.log" 2>/dev/null | cut -c1-300 || echo "(no events.log at $TASK_DIR)"

section "4. queue"
node "$BIN/mythos-ai-executor" list 2>/dev/null | node -e '
  var s = ""; process.stdin.on("data", function (d) { s += d; }).on("end", function () {
    try {
      var l = JSON.parse(s); l = Array.isArray(l) ? l : (l.tasks || []);
      var c = {}; l.forEach(function (x) { var e = x.effective || x.status; c[e] = (c[e] || 0) + 1; });
      console.log(JSON.stringify(c));
      l.filter(function (x) { return ["RUNNING","INTERRUPTED","WAITING_RETRY","WAITING_FOR_QUOTA","QUEUED"].indexOf(x.effective || x.status) !== -1; })
        .forEach(function (x) { console.log(x.task_id, x.effective || x.status, x.requested_by || "", x.updated_at || ""); });
    } catch (e) { console.log("(list unparsable)"); }
  });'
RUNNING_N="$(node "$BIN/mythos-ai-executor" list RUNNING 2>/dev/null | node -e '
  var s = ""; process.stdin.on("data", function (d) { s += d; }).on("end", function () {
    try { var l = JSON.parse(s); l = Array.isArray(l) ? l : (l.tasks || []); console.log(l.length); } catch (e) { console.log("unknown"); }
  });')"
echo "RUNNING in store: $RUNNING_N"

section "5. Resource Guard (its own state file, read-only)"
# Read the file rather than `mythos-resource-guard status`: status takes a
# fresh sample (and writes state) when the persisted one is older than 60 s.
# That age is itself evidence here: the daemon samples every tick (15 s), so
# a stale file means the daemon has stopped ticking.
GUARD_FILE="$STORE/resource-guard.json"
GUARD_LINE="$(node -e '
  try {
    var st = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    var age = Math.round((Date.now() - Date.parse(st.updated_at)) / 1000);
    console.log((st.level || "UNKNOWN") + " " + age);
    console.error("level=" + st.level + " updated_at=" + st.updated_at + " (" + age + " s ago)" +
      "\nlast_sample=" + JSON.stringify(st.last_sample || null) +
      "\npending=" + JSON.stringify(st.pending || st.candidate || null));
  } catch (e) { console.log("UNREADABLE -1"); console.error("unreadable: " + e.message); }
' "$GUARD_FILE" 2>&1 >/dev/null)"
LEVEL_AGE="$(node -e '
  try { var st = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        console.log((st.level || "UNKNOWN") + " " + Math.round((Date.now() - Date.parse(st.updated_at)) / 1000)); }
  catch (e) { console.log("UNREADABLE -1"); }' "$GUARD_FILE")"
echo "$GUARD_LINE"
LEVEL="${LEVEL_AGE%% *}"; GUARD_AGE="${LEVEL_AGE##* }"

section "6. host pressure"
uptime
grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree' /proc/meminfo
echo "psi memory: $(tr '\n' ' ' < /proc/pressure/memory)"
echo "psi cpu:    $(tr '\n' ' ' < /proc/pressure/cpu)"
echo "psi io:     $(tr '\n' ' ' < /proc/pressure/io)"
grep '^oom_kill' /proc/vmstat
echo "--- process states"; ps -eo stat= | cut -c1 | sort | uniq -c | tr '\n' ' '; echo
echo "--- top RSS"; ps -eo pid,user,stat,etime,pcpu,rss,comm --sort=-rss | head -12
echo "--- top CPU"; ps -eo pid,user,stat,etime,pcpu,rss,comm --sort=-pcpu | head -12

section "7. executor journal (last 30 min, filtered)"
journalctl --user -u "$UNIT" --since "-30min" --no-pager 2>/dev/null \
  | grep -Ei "$TASK_ID|defer|resource|error|lock|tick|listen|exit|killed" | tail -25

section "VERDICT"
DEFERRED="$(grep -c '"dispatch_deferred"' "$TASK_DIR/events.log" 2>/dev/null || echo 0)"
HUNG=no
if [ "$H1" != "200" ] && [ "$H1" != "503" ]; then
  sleep 20; H2="$(health)"; echo "GET /health retry: http=${H2:-none}"
  if [ "$H2" != "200" ] && [ "$H2" != "503" ]; then HUNG=yes; fi
fi
if [ "$HUNG" = yes ]; then
  echo "B: the executor daemon is not answering /health (twice, 20 s apart). The queue is not being ticked."
elif [ "${GUARD_AGE:--1}" -gt 120 ] 2>/dev/null; then
  echo "B': /health answers but the guard was last sampled ${GUARD_AGE} s ago — the HTTP side is up, the tick loop is not."
  echo "    (--restart-if-hung does not act on this: it requires /health to fail; decide from the journal above.)"
elif [ "$LEVEL" = CRITICAL ]; then
  echo "A: Resource Guard is CRITICAL — fresh admission is refused by design (dispatch_deferred events: $DEFERRED)."
  echo "   Fix: free memory (see top RSS above). The task starts on its own once the guard de-escalates"
  echo "   (5 consecutive healthy samples, ~10 min). Do NOT run 'mythos-ai-executor run' now: it bypasses the guard."
elif [ "$DEFERRED" -gt 0 ]; then
  echo "A': the task was deferred earlier ($DEFERRED dispatch_deferred) but the guard reads ${LEVEL:-unknown} now;"
  echo "    the next tick should start it. Re-run this script in 1 minute."
else
  echo "C: daemon answers, guard ${LEVEL:-unknown}, no deferral recorded — read the journal section above."
fi

if [ "$ACTION" = --restart-if-hung ]; then
  section "ACTION --restart-if-hung"
  if [ "$HUNG" != yes ]; then
    echo "not restarting: /health answers, so the daemon is not hung."
  elif [ "$RUNNING_N" != 0 ]; then
    echo "not restarting: RUNNING in store = $RUNNING_N — a restart could cut a live run."
  else
    echo "restarting $UNIT (hung, nothing RUNNING) at $(date -u +%FT%TZ)"
    systemctl --user restart "$UNIT"
    for i in 1 2 3 4 5 6; do sleep 10; H3="$(health)"; echo "  +$((i*10))s /health http=$H3"; [ "$H3" = 200 ] || [ "$H3" = 503 ] && break; done
    sleep 30
    echo "--- task after restart"
    node "$BIN/mythos-ai-executor" status "$TASK_ID" 2>/dev/null | grep -oE '"(status|effective|next_action|started_at)": *"[^"]*"' | head -6
    tail -n 3 "$TASK_DIR/events.log" 2>/dev/null | cut -c1-300
  fi
fi
