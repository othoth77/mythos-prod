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
#   - one branch, one repo, fixed refspec — nothing else is ever pushed;
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
  echo "up to date at $LOCAL"
  exit 0
fi

if git merge-base --is-ancestor "$REMOTE" "$LOCAL"; then
  git -c core.hooksPath=/var/empty push origin "refs/heads/$BRANCH:refs/heads/$BRANCH"
  echo "pushed $REMOTE..$LOCAL"
else
  echo "REFUSED: local $BRANCH is not a fast-forward of origin/$BRANCH (diverged); manual resolution required" >&2
  exit 1
fi
