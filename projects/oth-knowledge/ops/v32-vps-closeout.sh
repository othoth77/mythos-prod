#!/usr/bin/env bash
# =====================================================
# MYTHOS V3.2 — VPS closeout (operator-executable, run ON the VPS as `deploy`)
# projects/oth-knowledge/ops/v32-vps-closeout.sh
#
# WHY THIS IS AN OWNER STEP. Every path from an AI session to the VPS was
# checked on 2026-09-25 and none may write there:
#   * Haddad -> VPS SSH: none, by design (no key registered; creating one
#     would be a new channel);
#   * the self-hosted runner `mythos-vps-runner`: read-only by design
#     (ProtectHome=read-only, NoNewPrivileges; the store is deploy 0700) —
#     using it to write would weaken a documented boundary;
#   * the VPS bridge/executor: intake alive, execution idle since 09-17,
#     and a store write / checkout pull is outside every enabled profile
#     (`deploy` is disabled in lib/policy.js);
#   * oth-mcp / ContextForge: read-only tools; the relay only pushes.
# So the owner runs this over their existing SSH channel
# (docs/OTH_KNOWLEDGE_OPERATIONS.md §6):
#
#   ssh deploy@51.68.226.211 'bash -s' < projects/oth-knowledge/ops/v32-vps-closeout.sh
#
# WHAT IT DOES, all idempotent, each step fail-closed:
#   1. fast-forwards the VPS checkout to origin/main (refuses local changes
#      other than the known free-LLM catalog drift, which it resets exactly
#      as the OTHMODE V2 deploy procedure did);
#   2. backs up the canonical store with the existing ops/backup.sh;
#   3. loads every committed seed with the existing CLI (append-only,
#      idempotent: re-running adds nothing) and validates the store;
#   4. restarts the two user services that cache what changed:
#      oth-knowledge-http (opens the store once) and mythos-command-center
#      (the new project_context projection is code);
#   5. verifies locally: store valid, V3.2 claims retrievable, the
#      registry the command center serves has the expected track count.
# It never touches credentials, root, the executor daemon, or any other
# service. The VPS executor keeps running its loaded code (MERGED is not
# RUNNING there until its own governed restart — deliberately not done here).
# =====================================================
set -euo pipefail

REPO="${MYTHOS_REPO:-/home/deploy/projects/mythos-prod}"
STORE="${OTHK_STORE:-/home/deploy/othk-store}"
BACKUPS="${OTHK_BACKUPS:-/home/deploy/othk-backups}"
EXPECT_USER="${EXPECT_USER:-deploy}"
EXPECT_TRACKS="${EXPECT_TRACKS:-36}"
SKIP_SERVICES="${SKIP_SERVICES:-0}"           # tests only
DRIFT_OK="projects/mythos-ai-executor/free-llm/catalog.json"

say()  { printf '%s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

say "== 0. preflight"
[ "$(id -un)" = "$EXPECT_USER" ] || fail "run as $EXPECT_USER, not $(id -un)"
[ -d "$REPO/.git" ] || [ -f "$REPO/.git" ] || fail "no checkout at $REPO"
[ -d "$STORE" ] || fail "canonical store $STORE does not exist (provisioning is a separate operator step)"
command -v node >/dev/null || fail "node missing"

say "== 1. checkout -> origin/main (fast-forward only)"
git -C "$REPO" fetch --quiet origin main
DIRTY="$(git -C "$REPO" status --porcelain --untracked-files=no)"
if [ -n "$DIRTY" ]; then
  OTHER="$(printf '%s\n' "$DIRTY" | awk '{print $2}' | grep -v -x "$DRIFT_OK" || true)"
  [ -z "$OTHER" ] || fail "tracked local changes other than the known drift — resolve by hand:
$OTHER"
  say "   resetting the known free-LLM catalog drift ($DRIFT_OK)"
  git -C "$REPO" checkout -- "$DRIFT_OK"
fi
BEFORE="$(git -C "$REPO" rev-parse HEAD)"
git -C "$REPO" merge --ff-only --quiet origin/main || fail "not a fast-forward: the checkout diverged from origin/main"
AFTER="$(git -C "$REPO" rev-parse HEAD)"
say "   $BEFORE -> $AFTER"
SEEDS_DIR="$REPO/projects/oth-knowledge/seeds"
for must in mythos-ecosystem-2026-09-24.json mythos-project-graph-2026-09-25.json mythos-haddad-node-2026-09-24.json; do
  [ -f "$SEEDS_DIR/$must" ] || fail "expected V3.2 seed missing after the pull: $must"
done

CLI="$REPO/projects/oth-knowledge/cli/othk-cli.js"

say "== 2. backup (existing ops/backup.sh)"
mkdir -p "$BACKUPS"
bash "$REPO/projects/oth-knowledge/ops/backup.sh" "$STORE" "$BACKUPS/pre-v32-$(date -u +%Y%m%dT%H%M%SZ)"

say "== 3. seed every committed seed (idempotent) + validate"
RECORDS_BEFORE="$(node "$CLI" --store "$STORE" stats | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.records!==undefined?j.records:JSON.stringify(j))})')"
for f in "$SEEDS_DIR"/*.json; do
  say "   seed $(basename "$f")"
  node "$CLI" --store "$STORE" seed "$f" >/dev/null
done
node "$CLI" --store "$STORE" validate >/dev/null || fail "store validation failed after seeding"
RECORDS_AFTER="$(node "$CLI" --store "$STORE" stats | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.records!==undefined?j.records:JSON.stringify(j))})')"
say "   records: $RECORDS_BEFORE -> $RECORDS_AFTER (validate: ok)"

say "== 4. restart the two services that cache what changed"
if [ "$SKIP_SERVICES" != "1" ]; then
  systemctl --user restart oth-knowledge-http.service
  systemctl --user restart mythos-command-center.service
  sleep 3
  systemctl --user is-active --quiet oth-knowledge-http.service || fail "oth-knowledge-http did not come back"
  systemctl --user is-active --quiet mythos-command-center.service || fail "mythos-command-center did not come back"
else
  say "   (skipped: SKIP_SERVICES=1)"
fi

say "== 5. verify"
HITS="$(node "$CLI" --store "$STORE" search "Haddad EXECUTES a second project oth-knowledge" --mode hybrid --limit 5)"
printf '%s' "$HITS" | grep -qi "second bridge instance" || fail "the V3.2 cross-project claim is not retrievable from the canonical store"
say "   V3.2 claim retrievable from $STORE"
REL="$(node -e '
  const B=process.argv[1]+"/projects/oth-knowledge/lib/";
  const s=require(B+"store.js").openStore(process.argv[2]);
  console.log(s.allRecords({kind:"relationship"}).length);' "$REPO" "$STORE")"
# 19 (ecosystem) + 7 (project graph) - 1 asserted by both (executor depends_on orchestrator;
# relationship ids are deterministic, entities merge across seeds) = 25 distinct.
[ "$REL" -ge 25 ] || fail "expected >= 25 typed relationships in the store, found $REL"
say "   typed relationships in the store: $REL"
TRACKS="$(OTHMODE_REPO_ROOT="$REPO" node -e '
  const r=require(process.argv[1]+"/projects/command-center/reference/othmode/registries.js");
  const p=r.projects(); const t=p.projects.find(x=>x.id==="mythos-haddad");
  console.log(p.total+" "+(t&&t.shared_platform_capabilities?t.shared_platform_capabilities.length:0));' "$REPO")"
set -- $TRACKS
[ "$1" = "$EXPECT_TRACKS" ] || fail "project_context would serve $1 tracks, expected $EXPECT_TRACKS"
[ "$2" -ge 1 ] || fail "project_context does not carry shared_platform_capabilities"
say "   project_context read model: $1 tracks, capabilities passed through"
say "OK — V3.2 VPS closeout complete at $AFTER"
