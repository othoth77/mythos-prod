# Mythos Haddad — V0 status

**V0: COMPLETE — verified 2026-09-21 (issue #328). Delivered: PR #330 merged into `main` as `670b4268`; issues #328 and #329 closed.**

| V0 acceptance item | State | Evidence (2026-09-21, on `haddad`) |
|---|---|---|
| Reachable remotely | DONE | Tailscale `Running`, `100.78.7.10`; sshd log: login from the Windows peer `100.112.129.59` over Tailscale at 00:41 UTC (#329, closed) |
| SSH works | DONE | `ssh haddad`, `ssh othman@100.78.7.10`, `ssh othman@haddad.<tailnet>.ts.net` all pass with `BatchMode=yes`; port 22; host key checking on |
| Tailscale works | DONE | 1.102.4, peer `DESKTOP-DIUMTMT` online, direct path, ping 1 ms |
| Git works | DONE | 2.53.0, `ls-remote origin` OK |
| Node/npm work | DONE | Node 22.22.1, npm 9.2.0 |
| Claude Code authenticated and launches | DONE | 2.1.278 installed in `~/.local` (was `npx`-only), `claude auth status` → logged in, `claude -p` → `HADDAD-OK` |
| GPU detected + basic GPU test | DONE | GTX 1660 SUPER (TU116), `nouveau` + GSP 570.144, Vulkan 1.4.335 via NVK, 6 GB VRAM; 64 MiB GPU fill + host→VRAM→host round trip verified byte for byte (~3.4 / ~4.8 GiB/s) |
| Runtime dependencies | DONE | Python 3.14.4, libvulkan1, mesa-vulkan-drivers, render node access, `~/.local/share/mythos-haddad/{models,runtime}` |
| Structure / documentation | DONE | `projects/mythos-haddad/` — README (setup, operation, recovery, verification) |
| Health checks + logs | DONE | `haddad-health.js` 13/13 PASS; systemd user timer every 30 min, linger on; logs in `~/.local/state/mythos-haddad/logs/` |
| Reproducible verification | DONE | README → Verification; `tests/mythos-haddad-v0-test.js` 8/8; re-verified from a fresh clone of the pushed branch |
| Committed / pushed | DONE | branch `mythos-haddad/v0-base-server`, PR #330; remote HEAD checked against the local commit |

## Fixes made while completing V0

- `ssh haddad` failed with `Host key verification failed`: the machine's own names were missing from
  `known_hosts`. Entries added from the local host key file (not over the network); now part of `haddad-setup.sh`.
- `github.com` host keys added to `known_hosts` from GitHub's published key list (`api.github.com/meta`).
- Claude Code only existed as a running `npx` process; installed persistently so `claude` survives the session.
- Lingering enabled for `othman` so the health timer runs without a login session.

No root was used; no sshd, firewall, router or driver change was made.

## Known limits

See README → Known limits: no CUDA on the open driver stack (V1 decision), 8 GB RAM / HDD, correctable PCIe AER
errors from the GPU, sshd still accepts passwords, no SMART / fan sensors without extra packages.

## Next action

V1 scoping: choose the first AI runtime. The V0 stack already supports Vulkan backends (e.g. llama.cpp Vulkan);
switching to the proprietary NVIDIA driver for CUDA is a separate owner decision because it replaces the verified
stack. Before V1: add the Windows client's SSH key and set `PasswordAuthentication no`.
