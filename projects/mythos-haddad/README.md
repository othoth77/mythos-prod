# Mythos Haddad — V0 base AI server

Mythos Haddad is the on-premises AI server of the Mythos ecosystem: a single Ubuntu machine with a GPU,
reachable only over Tailscale, that Claude Code and later AI runtimes work on. **V0 is the verified,
reproducible base** — access, toolchain, GPU, health checks, logs, documentation. It deliberately contains
no Othmode integration, agents, GPU orchestration or model serving; those are V1+.

Current verified state: [STATUS.md](STATUS.md). Tracking: issues #328 (V0) and #329 (Tailscale remote SSH).

| | |
|---|---|
| Host | `haddad` — MSI B450M-A PRO MAX, Ryzen 5 1600 (6c/12t), 8 GB RAM, 1 TB HDD (100 GB LVM root) |
| GPU | NVIDIA GeForce GTX 1660 SUPER (TU116), 6 GB VRAM — `nouveau` + GSP firmware, Vulkan 1.4 through Mesa NVK |
| OS | Ubuntu 26.04 LTS, kernel 7.0 |
| Access | Tailscale only: `ssh othman@100.78.7.10` (port 22, not exposed publicly) |
| Toolchain | Git 2.53, Node.js 22 / npm 9, Python 3.14, Claude Code in `~/.local` |

## Layout

```
projects/mythos-haddad/
  README.md                      setup, operation, recovery (this file)
  STATUS.md                      last verified V0 state, blockers, next action
  bin/haddad-health.js           V0 health check -> JSON report + log (no deps, no root, read-only)
  bin/gpu-vulkan-test.py         basic GPU test on real VRAM (ctypes + libvulkan, no deps)
  bin/haddad-diagnostics.sh      hardware / system snapshot
  bin/haddad-setup.sh            idempotent user-level setup (dirs, Claude Code, known_hosts, health timer)
  systemd/                       user units for the scheduled health check
tests/mythos-haddad-v0-test.js   machine-independent invariants of the tooling
```

On the machine (outside Git, created by `haddad-setup.sh`):

```
~/.local/share/mythos-haddad/models     model files (V1+; empty in V0)
~/.local/share/mythos-haddad/runtime    AI runtime installs (V1+; empty in V0)
~/.local/state/mythos-haddad/           health-latest.json
~/.local/state/mythos-haddad/logs/      health.log, health-*.json (last 200), diagnostics-*.txt (last 20)
```

## Setup

From a fresh Ubuntu Server install to a verified V0. Steps 1–3 need root once; everything after is user-level.

1. **Base packages (root)**
   ```bash
   sudo apt update && sudo apt install -y openssh-server git nodejs npm python3 pciutils mesa-vulkan-drivers libvulkan1
   ```
   Keep SSH on port 22. Do not forward port 22 on the router and do not open it in any cloud/edge firewall.
2. **Tailscale (root)**
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```
   Authenticate into the owner's tailnet, then note the address: `tailscale ip -4`.
3. **GPU driver** — nothing to install. Ubuntu 26.04 drives the GTX 1660 SUPER with `nouveau` + GSP firmware
   (`linux-firmware-nvidia-graphics`) and Mesa NVK exposes it as a Vulkan 1.4 device. The user must be able to
   open `/dev/dri/renderD128` (granted to the logged-in user by logind; for a pure service account:
   `sudo usermod -aG render,video <user>`).
4. **Repository**
   ```bash
   mkdir -p ~/projects && cd ~/projects && git clone https://github.com/othoth77/mythos-prod.git
   ```
5. **User-level setup (idempotent)**
   ```bash
   bash ~/projects/mythos-prod/projects/mythos-haddad/bin/haddad-setup.sh
   ```
6. **Claude Code authentication (interactive, once)**
   ```bash
   claude auth login
   ```
7. **Verify** — see [Verification](#verification).

On each client (e.g. the Windows PC): install Tailscale, sign in to the same tailnet, then
`ssh othman@100.78.7.10`. On first connect the host key fingerprint must be
`SHA256:/laUQzhdSdGeadJN9u2zOpcE0m8lVgiFF3mSdvu8+zA` (ED25519).

## Operation

| Task | Command |
|---|---|
| Connect | `ssh othman@100.78.7.10` (or `ssh othman@haddad.<tailnet>.ts.net`; `ssh haddad` on the box) |
| Health check now | `node projects/mythos-haddad/bin/haddad-health.js` (`--quick` skips GPU test + network, `--json` for machines) |
| Last result | `cat ~/.local/state/mythos-haddad/health-latest.json` · history: `tail ~/.local/state/mythos-haddad/logs/health.log` |
| Scheduled checks | `systemctl --user list-timers mythos-haddad-health.timer` · `journalctl --user -u mythos-haddad-health -n 30` |
| GPU test only | `python3 projects/mythos-haddad/bin/gpu-vulkan-test.py` (`HADDAD_GPU_TEST_MIB=512` for a larger run) |
| Diagnostics | `bash projects/mythos-haddad/bin/haddad-diagnostics.sh` |
| Claude Code | `claude` (interactive) · `claude -p "…"` (headless) · `claude auth status` |
| Update Claude Code | `npm install -g --prefix ~/.local @anthropic-ai/claude-code` |
| Update the repo | `git -C ~/projects/mythos-prod pull --ff-only` |

The health check runs every 30 minutes (and 3 minutes after boot) as a systemd **user** timer with lingering
enabled, so it runs without a login session. It is read-only. Result semantics: `PASS`; `WARN` (degraded, exit
0: failed systemd unit, disk ≥ 85 %, high load, origin unreachable); `FAIL` (exit 1, the unit shows as failed).

## Recovery

| Symptom | Cause / fix |
|---|---|
| `ssh haddad` → `Host key verification failed` | The name is missing from `~/.ssh/known_hosts`. Re-run `haddad-setup.sh`: it adds the machine's own names from `/etc/ssh/ssh_host_ed25519_key.pub`. Never disable `StrictHostKeyChecking`. |
| Client warns `REMOTE HOST IDENTIFICATION HAS CHANGED` | Expected only after an OS reinstall. Compare with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the console, then `ssh-keygen -R 100.78.7.10` on the client. If the OS was not reinstalled, stop and investigate. |
| Not reachable over Tailscale | Console: `tailscale status`; `sudo systemctl restart tailscaled`; expired key → `sudo tailscale up`. Check the client is signed in to the same tailnet. LAN fallback: `ssh othman@192.168.1.105`. |
| `ssh` refused / timeout while Tailscale pings | `sudo systemctl status ssh`, `sudo systemctl enable --now ssh`, `ss -tln | grep :22`. |
| `claude: command not found` | `bash bin/haddad-setup.sh`; make sure `~/.local/bin` is on `PATH` (re-login). |
| `claude_code … NOT authenticated` | `claude auth login` from an interactive SSH session. |
| `gpu_test` FAIL / no hardware Vulkan device | `lsmod | grep nouveau`; `journalctl -k -b | grep -i -E 'nouveau|gsp'` must show `gsp: RM version`; packages `mesa-vulkan-drivers libvulkan1 linux-firmware-nvidia-graphics`; access to `/dev/dri/renderD128`. Reboot after a kernel/firmware update. |
| Health timer not running | `systemctl --user status mythos-haddad-health.timer`; re-run `haddad-setup.sh`; `loginctl show-user $USER -p Linger` must be `yes`. |
| Repo moved | Re-run `haddad-setup.sh` from the new path: the unit is regenerated with the new location. |
| Full rebuild | Follow [Setup](#setup) top to bottom. Nothing in V0 lives only on the machine except the Claude Code login, the Tailscale node key, `~/.ssh` and the logs. |

## Verification

V0 is reproducible from this file: every acceptance item of issue #328 maps to one health check.

```bash
cd ~/projects/mythos-prod
node projects/mythos-haddad/bin/haddad-health.js   # 13 checks, must end with RESULT: PASS
node tests/mythos-haddad-v0-test.js                # tooling invariants, must end with 0 failed
claude -p "Reply with exactly: HADDAD-OK"          # Claude Code launches and answers
```

From a remote tailnet client: `ssh othman@100.78.7.10 'hostname'` → `haddad`.

| V0 acceptance item | Check |
|---|---|
| reachable remotely | `tailscale`, `remote_access` (SSH over the Tailscale address + last login from a remote peer) |
| SSH works | `ssh` |
| Tailscale works | `tailscale` |
| Git works | `git` (version + `ls-remote origin`) |
| Node/npm work | `node` |
| Claude Code authenticated and launches | `claude_code` + the `claude -p` command above |
| GPU detected, basic GPU test | `gpu_detect`, `gpu_test` |
| runtime dependencies installed | `runtime` |
| structure / documentation | this directory + `tests/mythos-haddad-v0-test.js` |
| health checks, logs | `logs`, `systemd`, `resources`, the user timer |

## Known limits (accepted for V0)

- **No CUDA.** The GPU runs on the open `nouveau`/NVK stack, which gives Vulkan compute. CUDA-only runtimes need
  the proprietary driver (`sudo ubuntu-drivers install`, reboot) — a V1 decision, since it replaces the working
  stack. Vulkan-capable runtimes (e.g. llama.cpp's Vulkan backend) work on the V0 stack as is.
- **8 GB RAM / 6 GB VRAM / HDD** bound the model sizes V1 can serve.
- **Correctable PCIe AER errors** from the GPU (`0000:29:00.0`, Physical Layer) appear in the kernel log. They are
  corrected by hardware and the GPU test passes; if they grow or become uncorrectable, reseat the card / try
  `pcie_aspm=off`.
- **sshd still accepts passwords.** Exposure is limited to the LAN and the tailnet. Once every client logs in
  with a key: `PasswordAuthentication no` in `/etc/ssh/sshd_config.d/` (root).
- SMART and fan sensors need `smartmontools` / `lm-sensors` (root, optional).
