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
  git -c core.hooksPath=/var/empty push origin "refs/heads/$BRANCH:refs/heads/$BRANCH"
  echo "pushed $REMOTE..$LOCAL"
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
  if git -c core.hooksPath=/var/empty push --quiet origin "$ref:$ref"; then
    MISSION_PUSHED=$((MISSION_PUSHED + 1))
  else
    echo "skipped $short: push failed" >&2
    MISSION_SKIPPED=$((MISSION_SKIPPED + 1))
  fi
done < <(git for-each-ref --format='%(refname)' 'refs/heads/mythos/')

echo "mission branches: pushed=$MISSION_PUSHED skipped=$MISSION_SKIPPED"

if [ "${MAIN_DIVERGED:-0}" = "1" ]; then
  exit 1
fi
