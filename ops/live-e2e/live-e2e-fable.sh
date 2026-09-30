#!/usr/bin/env bash
# =====================================================
# MYTHOS — Live E2E through the REAL Fable 5.1 path (run ON the VPS as `deploy`)
# ops/live-e2e/live-e2e-fable.sh
#
# WHY THIS IS AN OWNER STEP. Fable 5.1 runs only where the Claude execution
# provider runs: the VPS executor (config/model-policy.json "fable-5.1",
# verified there 2026-09-03). The supervisor monitors execution through the
# executor's LOCAL CLI, so a supervisor for a Fable task must run on the VPS
# too. No AI session may act there: there is no Haddad→VPS SSH by design,
# the self-hosted runner is read-only, and the executor daemon is a HostOps
# protected unit (owner-only restart). So the owner runs, over their own
# SSH channel:
#
#   ssh deploy@51.68.226.211 'bash -s' < ops/live-e2e/live-e2e-fable.sh
#
# PRECONDITIONS it VERIFIES (and refuses to run without — fail closed):
#   1. the VPS checkout contains the measured-outcome fix (FIX_COMMIT);
#   2. the executor daemon STARTED AFTER that checkout moved (MERGED is not
#      RUNNING: a daemon started earlier still runs the old settlement);
#   3. the governance relay (mythos-git-push.timer) is active — it is the
#      only delivery path for task-branch commits;
#   4. the chosen artifact directory exists on origin/main (the #542 task
#      failed partly because its directory did not exist).
# It does NOT pull, restart, or change any service: preconditions are the
# owner's governed steps (see the README next to this file).
#
# WHAT IT DOES: one supervised task, in an ISOLATED supervisor store with a
# strict config (no recovery, no Qwen, no OpenAI: every criterion is a
# machine check and a failure stops for a person):
#   objective  create docs/evidence/<file> with a unique marker line
#   Model      Fable 5.1 (supervisor.json executor_model)
#   Validation `node scripts/mythos-assert-file.js <file> <MARKER>` — re-run
#              by the EXECUTOR after Fable finishes (mechanical, measured)
#   Acceptance status_completed, files_changed (measured on GitHub),
#              file_contains (read from GitHub at the verified head),
#              commit_delivered (GitHub shows the commit on the task branch)
#   Identity   the supervisor requires the executor-MEASURED serving model
#              to be claude-fable-5-1 (claude -p modelUsage)
# then ticks it to a terminal state and prints the evidence. It reads no
# secret and prints no environment.
# =====================================================
set -euo pipefail

REPO="${MYTHOS_REPO:-/home/deploy/projects/mythos-prod}"
FIX_COMMIT="${FIX_COMMIT:?set FIX_COMMIT to the merge commit of the measured-outcome PR}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MARKER="LIVE-E2E-FABLE-${STAMP}"
ARTIFACT_DIR="docs/evidence"
ARTIFACT="${ARTIFACT_DIR}/LIVE_E2E_FABLE_${STAMP}.md"
STORE="${HOME}/mythos-live-e2e/${STAMP}"
MAX_MINUTES="${MAX_MINUTES:-60}"

say() { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
die() { say "REFUSED: $*"; exit 3; }

say "== preconditions"
cd "$REPO"
git fetch --quiet origin main
HEAD_SHA="$(git rev-parse HEAD)"
say "checkout HEAD ${HEAD_SHA:0:12}  origin/main $(git rev-parse --short=12 origin/main)"
git merge-base --is-ancestor "$FIX_COMMIT" HEAD || die "checkout ${HEAD_SHA:0:12} does not contain FIX_COMMIT ${FIX_COMMIT:0:12} — fast-forward it first"
git cat-file -e "origin/main:${ARTIFACT_DIR}" 2>/dev/null || die "${ARTIFACT_DIR} does not exist on origin/main"
git cat-file -e "origin/main:scripts/mythos-assert-file.js" 2>/dev/null || die "scripts/mythos-assert-file.js is not on origin/main"

HEAD_TIME="$(git log -1 --format=%ct HEAD)"
# When the checkout last MOVED (the reflog entry of the fast-forward), not
# when its HEAD commit was authored: the daemon must have started after it.
MOVED_TIME="$(git reflog -1 --date=unix --format=%gd HEAD 2>/dev/null | tr -dc '0-9')"
[ -n "$MOVED_TIME" ] && [ "$MOVED_TIME" -gt "$HEAD_TIME" ] || MOVED_TIME="$HEAD_TIME"
EXEC_START="$(systemctl --user show mythos-ai-executor.service -p ExecMainStartTimestamp --value 2>/dev/null || true)"
[ -n "$EXEC_START" ] || die "mythos-ai-executor.service has no start timestamp (is it running?)"
EXEC_EPOCH="$(date -d "$EXEC_START" +%s)"
say "executor started ${EXEC_START}; checkout moved $(date -u -d @"$MOVED_TIME" +%FT%TZ)"
[ "$EXEC_EPOCH" -ge "$MOVED_TIME" ] || die "the executor daemon started BEFORE the checkout moved — it still runs the old settlement. Restart it through the governed path, then rerun."
systemctl --user is-active --quiet mythos-ai-executor.service || die "mythos-ai-executor.service is not active"
systemctl is-active --quiet mythos-git-push.timer 2>/dev/null || systemctl --user is-active --quiet mythos-git-push.timer 2>/dev/null \
  || die "mythos-git-push.timer (the governance relay) is not active — task-branch commits would never reach GitHub"
node -e 'var p=require(process.argv[1]);var e=p.catalog&&p.catalog["fable-5.1"];if(!e||!e.enabled||e.model!=="claude-fable-5-1")process.exit(1)' \
  "$REPO/projects/mythos-ai-executor/config/model-policy.json" || die "fable-5.1 is not an enabled catalog entry mapping to claude-fable-5-1"
say "preconditions: all met"

say "== strict E2E supervisor config (isolated store ${STORE})"
mkdir -p "$STORE"
CFG="${STORE}/supervisor-e2e.json"
node -e '
var fs=require("fs");var base=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
Object.assign(base,{_comment:"live-e2e-fable.sh: supervisor.json with no recovery, no Qwen, no OpenAI; generated, not committed",
  max_recoveries_per_root:0,max_attempts_per_task:1,qwen_enabled:false,max_openai_calls_per_root:0,max_openai_calls_per_task:0,max_openai_calls_per_recovery:0,
  executor_bin:process.argv[3]+"/projects/mythos-ai-executor/bin/mythos-ai-executor"});
if(base.executor_model!=="Fable 5.1"){console.error("supervisor.json executor_model is not Fable 5.1");process.exit(1)}
fs.writeFileSync(process.argv[2],JSON.stringify(base,null,2));' \
  "$REPO/projects/mythos-orchestrator/config/supervisor.json" "$CFG" "$REPO"

export MYTHOS_SUPERVISOR_CONFIG="$CFG" MYTHOS_SUPERVISOR_HOME="$STORE"
SUP="node $REPO/scripts/mythos-supervise.js"

say "== T1 submit"
$SUP submit --action document --timeout 1800 \
  --title "Live E2E Fable 5.1 ${STAMP}" \
  --objective "Create the file ${ARTIFACT} (the directory ${ARTIFACT_DIR}/ already exists) containing exactly two lines: '# Live E2E Fable 5.1 ${STAMP}' and 'marker: ${MARKER}'. Change no other file. Commit it on your task branch. Report the file you created." \
  --scope "${ARTIFACT}" \
  --constraint "Create only ${ARTIFACT}; touch no other path." \
  --validation "node scripts/mythos-assert-file.js ${ARTIFACT} ${MARKER}" \
  --check status_completed \
  --check "files_changed:${ARTIFACT}" \
  --check "file_contains:${ARTIFACT}::marker: ${MARKER}" \
  --check commit_delivered | tee "${STORE}/submit.json"
TASK_ID="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).task_id)' "${STORE}/submit.json")"

say "== T2..T11 supervise ${TASK_ID} (max ${MAX_MINUTES} min)"
set +e
$SUP watch "$TASK_ID" --interval 30 --max-minutes "$MAX_MINUTES" | tee "${STORE}/watch.log"
WATCH_RC=${PIPESTATUS[0]}
set -e

say "== T12 trace"
$SUP trace "$TASK_ID" > "${STORE}/trace.json" || true
node -e '
var t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
t.forEach(function(e){console.log((e.at||e.ts)+" "+(e.event||e.type)+" "+(e.execution_id||"")+(e.reason?" "+String(e.reason).slice(0,160):""))});' "${STORE}/trace.json" || true

say "== evidence"
node -e '
var fs=require("fs"),path=require("path");
var store=process.argv[1], repo=process.argv[2], id=process.argv[3];
var task=JSON.parse(fs.readFileSync(path.join(store,"tasks",id+".json"),"utf8"));
var ex=(task.executions||[]).slice(-1)[0]||{};
var out={task_id:id,status:task.status,issue:task.issue_number,execution_id:ex.execution_id||null,bridge_task_id:ex.bridge_task_id||null,
  executor_task_id:ex.executor_task_id||null,delivery_check:task.delivery_check?{verified:task.delivery_check.verified,branch:task.delivery_check.branch,head:task.delivery_check.head,files:task.delivery_check.files,read:Object.keys(task.delivery_check.contents||{})}:null,
  verified:task.verified?task.verified.review:null,blocked:task.blocked||null,last_error:task.last_error||null};
var home=process.env.MYTHOS_EXECUTOR_HOME||path.join(process.env.HOME,"mythos-ai-executor");
if(out.executor_task_id){try{var r=JSON.parse(fs.readFileSync(path.join(home,"tasks",out.executor_task_id,"report.json"),"utf8"));
  out.executor={provider_used:r.provider_used,model_used:r.model_used,measured:r.measured,problems:r.problems,blocker:r.blocker?r.blocker.code:null};}catch(e){out.executor={unreadable:String(e.message).slice(0,120)}}}
console.log(JSON.stringify(out,null,2));' "$STORE" "$REPO" "$TASK_ID" | tee "${STORE}/evidence.json"

say "store kept at ${STORE} (task, journal, trace, evidence). watch exit ${WATCH_RC} (0 = COMPLETED, 2 = BLOCKED)."
exit "$WATCH_RC"
