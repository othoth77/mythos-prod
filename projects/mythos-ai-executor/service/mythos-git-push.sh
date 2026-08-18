#!/usr/bin/env bash
# Mythos — GitHub delivery relay (stage MYTHOS-GIT-DELIVERY-0).
#
# Delivers already-committed work on the shared checkout's main branch to
# origin, running as the `deploy` user whose on-disk GitHub key
# (~/.ssh/id_ed25519_github, 0600, outside Git) is the deployment
# environment's persistent machine credential. The executor daemon (ubuntu,
# NoNewPrivileges) keeps committing locally exactly as before; this relay is
# what makes delivery survive reboots and session-agent loss.
#
# Safety properties, enforced here rather than assumed:
#   - fast-forward only: a diverged local main is REFUSED, never forced;
#   - one repo, fixed refspecs — main, plus the namespaced autonomous
#     mission branches refs/heads/mythos/* (added 2026-08-18 with owner
#     authorisation so completed missions are not stranded on one host);
#     nothing outside those two shapes is ever pushed, and pushing a
#     mission branch never merges it;
#   - GIT_SSH_COMMAND pins the identity (env overrides any repo config);
#   - core.hooksPath is overridden so repo-writable hooks cannot run as
#     `deploy` (the checkout is writable by another user);
#   - no credential is read, printed, or copied by this script.
#
# Install (root, one-time — deliberately not part of deploy/install.sh,
# which runs unprivileged as ubuntu):
#   cp service/mythos-git-push.sh /usr/local/bin/mythos-git-push   (0755 root)
#   cp service/mythos-git-push.{service,timer} /etc/systemd/system/
#   systemctl daemon-reload && systemctl enable --now mythos-git-push.timer
set -euo pipefail

REPO=/home/deploy/projects/mythos-prod
BRANCH=main
export GIT_SSH_COMMAND="ssh -o IdentitiesOnly=yes -i /home/deploy/.ssh/id_ed25519_github"

# --- Governance delivery invariant (closes GI-2026-08-18-01) ------------------
#
# Delivery is the one place every path to GitHub converges — mission commits,
# interactive commits, anything. The cage used to be checked only at mission
# acceptance, so an interactive session committing to the main checkout was
# never evaluated and a caged file reached origin/main. Now no ref is pushed
# until a ROOT-OWNED verifier confirms that every protected change in it
# carries a valid, signed, commit-bound approval.
#
# The verifier and its protected-path list live OUTSIDE the repository on
# purpose: a session that can edit the repo must not be able to edit its own
# cage away. This script never consults the repo copy.
#
# On denial the rule is DENY + RECORD + CONTINUE: the offending ref is not
# pushed, the denial is logged, other refs still go. Nothing is reverted and
# no human is asked — unattended operation must not block on a question.
GOV_VERIFY=${MYTHOS_GOV_VERIFIER:-/usr/local/lib/mythos/governance-verify.js}

gov_check () {   # gov_check <ref-name> <range>
  local ref="$1" range="$2"
  if [ ! -f "$GOV_VERIFY" ]; then
    echo "REFUSED $ref: governance verifier missing at $GOV_VERIFY (failing closed)" >&2
    return 1
  fi
  if node "$GOV_VERIFY" verify --repo "$REPO" --range "$range" --ref "$ref"; then
    return 0
  fi
  return 1
}

cd "$REPO"
git -c core.hooksPath=/var/empty fetch --quiet origin "$BRANCH"

LOCAL=$(git rev-parse "refs/heads/$BRANCH")
REMOTE=$(git rev-parse "refs/remotes/origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  # Up to date is NOT the end of the run any more: mission branches are
  # delivered below and main being current says nothing about them. (This
  # used to `exit 0` here, which silently skipped the whole mission-branch
  # block on exactly the common case.)
  echo "up to date at $LOCAL"
elif git merge-base --is-ancestor "$REMOTE" "$LOCAL"; then
  if gov_check "$BRANCH" "$REMOTE..$LOCAL"; then
    git -c core.hooksPath=/var/empty push origin "refs/heads/$BRANCH:refs/heads/$BRANCH"
    echo "pushed $REMOTE..$LOCAL"
  else
    echo "DENIED: $BRANCH holds an unapproved protected change; not delivered (recorded)" >&2
    MAIN_DENIED=1
  fi
else
  echo "REFUSED: local $BRANCH is not a fast-forward of origin/$BRANCH (diverged); manual resolution required" >&2
  MAIN_DIVERGED=1
fi

# --- Autonomous mission branches (owner-authorised 2026-08-18) ----------------
#
# The autonomous loop commits each mission to its own mythos/<mission>/<task>
# branch and NOTHING ever merged them to main, so until now every completed
# mission existed only on this host — a host failure would have lost the work.
# Delivering them is the durability half of "GitHub is the source of truth".
#
# This stays strictly additive and keeps every safety property above:
#   - fast-forward only, per branch: a diverged mission branch is SKIPPED,
#     never forced, and never deleted;
#   - the refspec is still fixed and namespaced — only refs/heads/mythos/*
#     is eligible, so this can never push some other local branch;
#   - a single branch failing never fails the relay run, because main's
#     delivery must not depend on mission housekeeping;
#   - pushing a branch does NOT merge it. Review and merge to main remain a
#     human decision exactly as before; this only makes the work durable.
MISSION_PUSHED=0
MISSION_SKIPPED=0
MISSION_DENIED=0
while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  short=${ref#refs/heads/}
  lsha=$(git rev-parse "$ref")
  if git rev-parse --verify --quiet "refs/remotes/origin/$short" >/dev/null; then
    rsha=$(git rev-parse "refs/remotes/origin/$short")
    [ "$lsha" = "$rsha" ] && continue
    if ! git merge-base --is-ancestor "$rsha" "$lsha"; then
      echo "skipped $short: diverged from origin (never forced)" >&2
      MISSION_SKIPPED=$((MISSION_SKIPPED + 1))
      continue
    fi
  fi
  # The governance invariant applies to mission branches too. The cage stops
  # the LOOP from committing a protected change, but a branch is just a ref —
  # anything could have written it. Delivery is where that is settled.
  gov_range="$lsha"
  if git rev-parse --verify --quiet "refs/remotes/origin/$short" >/dev/null; then
    gov_range="$(git rev-parse "refs/remotes/origin/$short")..$lsha"
  else
    gov_range="$(git rev-parse "$BRANCH")..$lsha"
  fi
  if ! gov_check "$short" "$gov_range"; then
    echo "DENIED $short: unapproved protected change; not delivered (recorded)" >&2
    MISSION_DENIED=$((MISSION_DENIED + 1))
    continue
  fi
  if git -c core.hooksPath=/var/empty push --quiet origin "$ref:$ref"; then
    MISSION_PUSHED=$((MISSION_PUSHED + 1))
  else
    echo "skipped $short: push failed" >&2
    MISSION_SKIPPED=$((MISSION_SKIPPED + 1))
  fi
done < <(git for-each-ref --format='%(refname)' 'refs/heads/mythos/')

echo "mission branches: pushed=$MISSION_PUSHED skipped=$MISSION_SKIPPED denied=$MISSION_DENIED"

# DENY + RECORD + CONTINUE: a governance denial is a normal, expected outcome
# of unattended operation, not a relay failure. It is already recorded by the
# verifier, everything deliverable has been delivered, and no human was asked.
# Only a genuinely broken state (diverged main) is an error exit.
if [ "${MAIN_DIVERGED:-0}" = "1" ]; then
  exit 1
fi
exit 0
