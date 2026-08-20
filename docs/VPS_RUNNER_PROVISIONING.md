# Mythos OS — Self-Hosted Runner Provisioning (VPS Final Gate unblock)

**Status:** repository package COMPLETE — installation is a one-time
operator action on the VPS (root), because no AI session has an
execution path to the host (SSH network-blocked, HTTPS to the VPS
denied by organization egress policy — re-verified 2026-08-20; see the
VPS-PATH entry in `docs/AI_HANDOVER.md`).

This implements **Option B(2)** of the VPS-PATH findings: a
least-privilege GitHub Actions self-hosted runner on the Mythos VPS,
scoped to `othoth77/mythos-prod`, making the VPS Final Gate
AI-dispatchable end-to-end (via `workflow_dispatch`) without any
credential ever entering an AI session.

## 1. Package contents

| File | Purpose |
|---|---|
| `projects/infrastructure/github-runner/provision-runner.sh` | Idempotent root installer: account, runner, registration, unit |
| `projects/infrastructure/github-runner/mythos-gh-runner.service` | Hardened systemd unit (NoNewPrivileges, ProtectSystem=full, ProtectHome=read-only) |
| `projects/infrastructure/github-runner/verify-runner.sh` | Read-only security verification, PASS/FAIL per gate requirement |
| `.github/workflows/vps-final-gate.yml` | Manual-dispatch, read-only gate workflow on label `mythos-vps` |

## 2. Security model (gate order sections 3–4)

- Dedicated system account **`mythos-runner`** — locked password, home
  `/opt/mythos-gh-runner`, **no** docker group, **no** mythos-gov, **no**
  sudoers entry, not root.
- Unit runs with **`NoNewPrivileges=yes`**: `sudo`/setuid can never work
  from any job, so the "runner sudo boundary" is satisfied by granting
  **nothing**. Root-only remediations (docker-group removal, store
  provisioning) deliberately remain operator commands.
- **Repo-scoped registration** to `othoth77/mythos-prod` only, label
  `mythos-vps`, registered with a short-lived token that is never
  stored in Git or in the scripts (passed via `RUNNER_TOKEN` env at
  install time only).
- Governance boundary preserved: `mythos-runner` gets EACCES on
  `/etc/mythos/governance.key` (root:mythos-gov 0640) and on
  `/var/lib/mythos/governance/approvals`; `verify-runner.sh` and the
  workflow's smoke job both assert this fail-closed.
- `ProtectHome=read-only` keeps deploy's checkout and home unwritable
  from jobs; `/etc` and `/var` stay under real DAC so the EACCES probes
  measure true file modes.

## 3. One-time installation (operator, root, on the VPS)

1. On GitHub: `othoth77/mythos-prod` → **Settings → Actions → Runners →
   New self-hosted runner** (Linux, x64). Note the displayed **runner
   version**, **SHA-256 checksum**, and **registration token** (token
   expires in ~1 hour; it authorizes registration only, nothing else).
2. On the VPS, from the current `main` checkout:

   ```bash
   cd /home/deploy/projects/mythos-prod/projects/infrastructure/github-runner
   sudo RUNNER_TOKEN=<token> RUNNER_VERSION=<x.y.z> RUNNER_SHA256=<sha256> \
        bash provision-runner.sh
   ```

   The script is idempotent and ends by running `verify-runner.sh`;
   it exits non-zero on any security check failure.
3. Confirm on GitHub that runner **mythos-vps-runner** shows **Idle**.

### 3a. Rerunning after a partial install (no manual cleanup needed)

The script resumes from whatever state a previous run left behind — do
**not** delete the `mythos-runner` account or `/opt/mythos-gh-runner`
by hand:

- An existing `mythos-runner` account is adopted (its home is verified
  to be `/opt/mythos-gh-runner`; anything else is refused) and its
  password is re-locked on every run.
- Download and registration are tracked independently: binaries present
  but unregistered → only `config.sh` runs; nothing present → both run.
- Registration uses `--replace`, so a stale GitHub-side entry named
  `mythos-vps-runner` cannot block a rerun.
- `RUNNER_TOKEN` is only required while the runner is unregistered
  (no `/opt/mythos-gh-runner/.runner`). Registration tokens expire in
  ~1 hour — take a fresh one from the "New self-hosted runner" page for
  the rerun.

**2026-08-20 incident:** the first live install failed at extraction
with `tar ... Cannot open: Permission denied`. Root cause: the script
created its temp dir with `mktemp -d` as **root** (mode 0700,
root-owned), then extracted as the unprivileged `mythos-runner` user,
which could not open the tarball inside that directory. Fixed by
chowning the temp dir and tarball to `mythos-runner` before the
unprivileged `tar` (no mode widening, extraction still never runs as
root). Rerun the same install command from a checkout containing the
fix; the partially-created account is reused automatically.

## 4. Repository Actions settings (owner, once)

In `othoth77/mythos-prod` → Settings → Actions:

- **Actions permissions:** allow actions (at minimum `actions/checkout`).
- **Fork pull request workflows:** leave disabled/none (private repo
  default) — nothing but repository branches may reach the runner.
- **Workflow permissions:** read-only `GITHUB_TOKEN` (the gate workflow
  also pins `permissions: contents: read`).

## 5. Running the gate

Dispatch **VPS Final Gate** (Actions → VPS Final Gate → Run workflow).
The `smoke` job proves identity + boundary; the `gate` job collects the
section-5 baseline, reports the docker-group finding, runs the
governance invariant suite, reports knowledge config state, and records
the E2E suite's designed host refusal as the expected result.

An AI session can then trigger and read this workflow through the
GitHub API — no VPS credential, no egress exception required.

## 6. Governance-protected path note

`.github/workflows/**` is a protected path in `governance-verify.js`.
GitHub Actions executes the workflow from GitHub regardless, but the
on-VPS `mythos-git-push` relay will (correctly) refuse to fast-forward
the VPS checkout past a commit touching it until an explicit
`mythos-governance-approve` is recorded. Approve that delivery
deliberately; do not weaken the verifier.

## 7. Survival and rollback

- Reboot survival: the unit is `enabled` (verified by
  `verify-runner.sh`); `Restart=always` covers crashes.
- Runner auto-updates itself (GitHub default; `--disableupdate` was NOT
  passed, so no manual version chasing).
- Rollback/removal (root):
  `systemctl disable --now mythos-gh-runner` →
  `cd /opt/mythos-gh-runner && sudo -u mythos-runner ./config.sh remove --token <removal-token>` →
  `userdel -r mythos-runner` → delete the unit file. Remove the runner
  entry on GitHub if it lingers offline.

## 8. If a future gate step truly requires root

Not granted by default and not needed for the current gate. It would
require BOTH a conscious operator edit dropping `NoNewPrivileges` AND an
explicit `/etc/sudoers.d/` entry listing exact commands
(`sudo -l -U mythos-runner` must show only those). Never grant `ALL`,
never `NOPASSWD:ALL`, never docker-group membership. Prefer keeping
root steps as documented operator one-liners instead.
