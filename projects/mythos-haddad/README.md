# Mythos Haddad — on-premises AI server

> **Master entry point:** [MASTER_STATUS_AND_ROADMAP.md](MASTER_STATUS_AND_ROADMAP.md) — current status, architecture, V1/V2 roadmap, Jev design, model pools, priorities and deferred items. **Read this first when starting work.**

Mythos Haddad is the on-premises AI server of the Mythos ecosystem: a single Ubuntu machine with a GPU,
reachable only over Tailscale, that Claude Code and local AI runtimes work on. **V0** delivered the
verified, reproducible base — access, toolchain, GPU, health checks, logs, documentation. **HAD-2** (V1)
adds the first local AI runtime: llama.cpp on the Vulkan backend serving one pinned Qwen2.5-7B-Instruct
model, advisory only — see [docs/AI_RUNTIME.md](docs/AI_RUNTIME.md) for install, measurements and rollback.
**HAD-2b** makes that runtime usable by FABLE as a local worker: FABLE sends a task, reviews the result,
and issues a correction if it is inadequate — see [docs/FABLE_WORKER.md](docs/FABLE_WORKER.md).

Current verified state: [STATUS.md](STATUS.md). Tracking: issues #328 (V0) and #329 (Tailscale remote SSH);
V1 scope in `docs/MYTHOS_HADDAD_V1_SCOPE.md`.

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
  STATUS.md                      last verified state, blockers, next action
  docs/AI_RUNTIME.md             HAD-2: what's installed, commands, endpoint, measurements, rollback
  docs/FABLE_WORKER.md           HAD-2b: FABLE sends a task to Qwen, reviews it, corrects it
  docs/HADDAD_MCP.md             HAD-3: the VPS OTH MCP running on Haddad over SSH-stdio (audit, decision, E2E); §12 HAD-3b: the same MCP over HTTPS; §13 HAD-3c: /mcphaddad on the VPS
  bin/haddad-health.js           health check -> JSON report + log (no deps, no root, read-only)
  bin/gpu-vulkan-test.py         basic GPU test on real VRAM (ctypes + libvulkan, no deps)
  bin/haddad-gpu-vram.py         live VRAM heap query (Vulkan VK_EXT_memory_budget; known limit, see AI_RUNTIME.md)
  bin/haddad-diagnostics.sh      hardware / system snapshot
  bin/haddad-setup.sh            idempotent user-level setup (dirs, Claude Code, known_hosts, health timer)
  bin/haddad-runtime-install.sh  HAD-2: installs the llama.cpp Vulkan backend (no root, no source build)
  bin/haddad-model-install.sh    HAD-2: downloads + sha256-pins the one Qwen model
  bin/haddad-runtime-setup.sh    HAD-2: runs the two installers above + the systemd unit, end to end
  src/backend-loader-shim.c      HAD-2: the one small workaround this install needed (see AI_RUNTIME.md)
  lib/haddad-runtime.js          HAD-2b: binds the existing free-llm adapter to the local runtime
  bin/haddad-task.js             HAD-2b: the command FABLE runs — one task in, one result out
  systemd/                       user units for the health timer and the AI runtime service
tests/mythos-haddad-v0-test.js       machine-independent invariants of the V0 tooling
tests/mythos-haddad-runtime-test.js      machine-independent invariants of the HAD-2 tooling
tests/mythos-haddad-fable-worker-test.js FABLE local-worker invariants (offline, injected transport)
```

On the machine (outside Git, created by `haddad-setup.sh` / `haddad-runtime-setup.sh`):

```
~/.local/share/mythos-haddad/models/qwen2.5-7b-instruct-q4_k_m   the one pinned model (~4.4 GiB)
~/.local/share/mythos-haddad/runtime/llama.cpp                   llama.cpp Vulkan backend + loader shim
~/.config/mythos-haddad/runtime.key                               local API key (0600, never logged)
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
| AI runtime setup (HAD-2, once) | `bash projects/mythos-haddad/bin/haddad-runtime-setup.sh` |
| AI runtime status / restart | `systemctl --user status mythos-haddad-runtime` · `systemctl --user restart mythos-haddad-runtime` |
| AI runtime logs | `journalctl --user -u mythos-haddad-runtime -n 50` |
| Read Haddad over MCP (its health/GPU/runtime/worker via `haddad_health`; executor tasks/reports/budget; estate context) | `ssh othman@100.78.7.10 /home/othman/.local/bin/haddad-mcp-stdio.sh` as a stdio MCP server; probe: `node projects/mythos-haddad/bin/haddad-mcp-probe.js` — see [docs/HADDAD_MCP.md](docs/HADDAD_MCP.md) |
| The same MCP over HTTPS for a tailnet client (Streamable HTTP, bearer) | `https://haddad.tail23f990.ts.net/mcp` via Tailscale Serve in front of the unchanged VPS bridge on `127.0.0.1:8160`; `bash projects/mythos-haddad/bin/haddad-mcp-http-setup.sh --enable --serve`; probe: `node projects/mythos-haddad/bin/haddad-mcp-probe.js --http http://127.0.0.1:8160/mcp` — see [docs/HADDAD_MCP.md §12](docs/HADDAD_MCP.md) |
| Send a task to the local worker (FABLE) | `echo '{"instruction":"…"}' \| node projects/mythos-haddad/bin/haddad-task.js` — see [docs/FABLE_WORKER.md](docs/FABLE_WORKER.md) |
| Chat with the local model | `curl -H "Authorization: Bearer $(cat ~/.config/mythos-haddad/runtime.key)" -H 'Content-Type: application/json' http://127.0.0.1:8600/v1/chat/completions -d '{"model":"qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf","messages":[{"role":"user","content":"…"}]}'` |

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
| `ai_runtime` FAIL / `mythos-haddad-runtime` won't start | `journalctl --user -u mythos-haddad-runtime -n 50`. `status=31/SYS` (core-dump) means a seccomp filter is too tight — see the unit file's header, `SystemCallFilter`. `no CPU backend found` means the loader shim didn't run — see `docs/AI_RUNTIME.md`, "Why a loader shim exists". |
| Full rebuild | Follow [Setup](#setup) top to bottom, then `haddad-runtime-setup.sh`. Nothing lives only on the machine except the Claude Code login, the Tailscale node key, `~/.ssh`, the AI runtime API key and the logs — the model and engine are both re-downloadable/reproducible from `docs/AI_RUNTIME.md`. |

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
