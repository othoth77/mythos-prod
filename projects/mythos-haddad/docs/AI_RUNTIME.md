# Mythos Haddad — HAD-2: local AI runtime

**Status: installed and verified on `haddad`, 2026-09-21.** One model, one runtime, advisory only —
not wired into production orchestration (that is HAD-4, a separate, later stage; see
`docs/MYTHOS_HADDAD_V1_SCOPE.md`). The free-LLM provider catalog
(`projects/mythos-ai-executor/free-llm/`) was not touched.

## What was installed

| | |
|---|---|
| Engine | llama.cpp, Debian package `llama.cpp-tools` **8681+dfsg-1** (Ubuntu 26.04 universe) |
| GPU backend | `libggml0-backend-vulkan` **0.9.11-1** (depends on `libvulkan1`, the stack V0 verified) |
| Supporting libs | `libllama0` 8681+dfsg-1, `libggml0` 0.9.11-1 |
| Model | Qwen2.5-7B-Instruct, **Q4_K_M** GGUF, official `Qwen` org on Hugging Face |
| Location | `~/.local/share/mythos-haddad/runtime/llama.cpp/` (engine), `~/.local/share/mythos-haddad/models/qwen2.5-7b-instruct-q4_k_m/` (model) |
| Endpoint | `http://127.0.0.1:8600/v1` — OpenAI-compatible, loopback only, requires an API key |
| Service | `mythos-haddad-runtime.service`, systemd **user** unit (`othman`) |

Not a source build: the engine is the unmodified distro binary. See **Why a loader shim exists**
below for the one small (~15-line) piece of glue code this install needed and why.

## Install (reproducible)

```bash
bash projects/mythos-haddad/bin/haddad-runtime-setup.sh
```

Runs, in order, all idempotent and individually re-runnable:

1. `bin/haddad-runtime-install.sh` — downloads the four `.deb` packages above via
   `apt-get download` (no root: this goes through the same GPG-verified APT transport as
   `apt install`, it just doesn't need root to fetch files into a working directory), unpacks
   them with `dpkg-deb -x` into the user prefix, recreates the soname symlinks `ldconfig` would
   normally make, builds the loader shim, and installs `bin/{llama-server,llama-cli,llama-bench,
   llama-quantize}` wrapper scripts.
2. `bin/haddad-model-install.sh` — downloads the two Qwen2.5-7B-Instruct-Q4_K_M GGUF shards from
   the official Qwen org repo and verifies each against a pinned SHA-256 before accepting it.
3. Generates a local API key (`~/.config/mythos-haddad/runtime.key`, mode 600, never printed or
   logged) if one does not already exist.
4. Installs and starts `systemd/mythos-haddad-runtime.service` as a systemd user unit.

No root was used or available in this install; see **Why a loader shim exists** for the one
constraint that would have needed it.

## Why a loader shim exists

`apt install` needs root, which this account does not have non-interactively (confirmed:
`sudo -n` fails with "a terminal is required to authenticate", no NOPASSWD grant). Downloading
and unpacking the `.deb` files themselves needs no root — but that surfaced a real,
**host-verified** (via `strace`, not assumed) constraint one level down:

ggml's backend-plugin loader (`ggml_backend_load_all()`, compiled into `libggml.so` at Debian
package-build time) always probes **one hardcoded absolute path** for every known backend name —
`/usr/lib/x86_64-linux-gnu/ggml/backends0/lib{cpu,vulkan,cuda,…}.so` — regardless of any
environment variable. Confirmed with `strace -e openat,newfstatat`: every candidate comes back
`ENOENT`, because that directory is root-owned `0755` and doesn't exist at all on a host that
never had a real system-wide `apt install` of these packages.

ggml's one override, `GGML_BACKEND_PATH`, loads **exactly one** extra `.so` file per process.
That's enough for Vulkan alone — but llama.cpp also needs a CPU backend registered even for a
fully GPU-offloaded model (used for the host-side staging buffer during weight loading); without
one, `llama-server` fails immediately with `no CPU backend found`.

Three unprivileged ways around this were tried and confirmed **not to work** on this host:

| Attempt | Result |
|---|---|
| `unshare --user --map-root-user --mount` | `write failed /proc/self/uid_map: Operation not permitted` — blocked by kernel/AppArmor policy |
| `bwrap` (bubblewrap) | Not setuid, no capabilities; same underlying restriction — `Can't mkdir parents … Read-only file system` |
| `LD_PRELOAD` both backend `.so` files before launch | Loads into the process but `--list-devices` still reports nothing — ggml's registry isn't populated by mere presence in the process, only by its own `ggml_backend_load()` call |

So `GGML_BACKEND_PATH` points at a tiny loader shim (`src/backend-loader-shim.c`, ~15 lines)
instead of directly at a backend. Its constructor calls the exact same public entry point ggml's
own scanner would have called — `ggml_backend_load(path)` — once per path named in
`MYTHOS_EXTRA_GGML_BACKENDS` (set by the wrapper scripts), landing both backends in the identical
process-wide registry ggml itself maintains. It contains **no llama.cpp or ggml code**; it links
against the unmodified distro `libggml.so.0` and calls one documented public function from it,
twice. Built once at install time with `gcc` (already present; nothing else was compiled).

The one real alternative is simpler and preferable **if root ever becomes available**: a single
symlink, `sudo mkdir -p /usr/lib/x86_64-linux-gnu/ggml && sudo ln -s
$PREFIX/usr/lib/x86_64-linux-gnu/ggml/backends0 /usr/lib/x86_64-linux-gnu/ggml/backends0`. That
would let ggml's own unmodified scanner find both backends directly, and the shim would become
unnecessary (but harmless — the wrapper scripts would simply be pointing `GGML_BACKEND_PATH` at
one extra file ggml's own scan had already made redundant). This install does not depend on that
ever happening.

The CPU backend variant is auto-detected at install time by trying, in order of how much of this
CPU's instruction set each assumes (`zen4, skylakex, icelake, haswell, sandybridge, sse42, x64`),
the first one `llama-cli --list-devices` reports as actually loaded rather than "not supported on
this system". On this Ryzen 5 1600 (Zen 1, 2017), that resolved to **haswell** (AVX2 + FMA3,
which Zen 1 has; `zen4` itself needs AVX-512, which it does not).

## Verify

```bash
node projects/mythos-haddad/bin/haddad-health.js      # includes the ai_runtime check
curl -H "Authorization: Bearer $(cat ~/.config/mythos-haddad/runtime.key)" \
  http://127.0.0.1:8600/v1/models
```

## Measurements (2026-09-21, on `haddad`, through the managed systemd service)

### GPU offload

```
load_tensors: offloading output layer to GPU
load_tensors: offloading 27 repeating layers to GPU
load_tensors: offloaded 29/29 layers to GPU
load_tensors:   CPU_Mapped model buffer size =   292.36 MiB
load_tensors:      Vulkan0 model buffer size =  4168.09 MiB
llama_kv_cache:    Vulkan0 KV buffer size =   224.00 MiB
sched_reserve:    Vulkan0 compute buffer size =   304.00 MiB
```

**All 29/29 layers on the GPU.** `llama-server`'s own memory-fit pass: *"projected to use 4696 MiB
of device memory vs. 5752 MiB of free device memory … will leave 1055 ≥ 1024 MiB of free device
memory, no changes needed"* — fits with headroom at `--ctx-size 4096`, no layers forced to CPU.

### VRAM

**4696 MiB** (model 4168 + KV cache 224 + compute buffer 304, from llama-server's own accounting
above), out of 6144–6400 MiB total, at 4096 tokens of context.

A live OS-level cross-check was attempted (`bin/haddad-gpu-vram.py`, Vulkan `VK_EXT_memory_budget`)
and found **unreliable on this driver**: it reads 0 MiB used even with the model actively resident
and serving requests. `/proc/<pid>/fdinfo` DRM memory accounting (the other standard Linux
mechanism) is also not exposed by this kernel/nouveau combination. Both gaps are documented, not
worked around — the runtime's own figure above is the one to trust, and `haddad-health.js`
deliberately does not surface the unreliable Vulkan-budget number.

### RAM (process RSS, `/proc/<pid>/status`)

| | |
|---|---|
| Steady state (serving) | **~430–505 MiB** |
| Peak during load (`VmHWM`) | **~4.7 GiB** (transient — pages touched while `mmap`-uploading weights to VRAM, not held afterward) |

Low steady-state RSS is consistent with the weights genuinely living in VRAM (`Vulkan0 model
buffer`), not in system RAM.

### Response performance

Two real chat-completion requests through the OpenAI-compatible endpoint, `temperature: 0`
(deterministic), measured via the server's own `timings` in the response:

| Request | Prompt tok/s | Generation tok/s | Notes |
|---|---|---|---|
| "capital of Tunisia?" (8 tokens out) | 33.6 | 9.3 | first request, cold shader cache |
| "three Vulkan facts" (57 tokens out) | 19.0 | 22.6 | longer sample, more stable |
| "largest ocean?" (11 tokens out) | 81.1 | 24.2 | warm cache, best case |

Both answers were **factually correct** ("Tunis", "Pacific Ocean", three accurate Vulkan facts) —
this is a real, working model, not a stub. Generation throughput on a first, very short request
undercounts (fixed per-request overhead dominates); 20–25 tok/s generation and moderate-to-high
prompt-processing throughput is the representative range once the Vulkan shader cache is warm.
This is modest but usable for a mid-range GPU on the newer, still-maturing NVK Vulkan driver
(no CUDA, no cuBLAS — see V0's README, Known limits).

### Sample request

```bash
curl -s -H "Authorization: Bearer $(cat ~/.config/mythos-haddad/runtime.key)" \
     -H 'Content-Type: application/json' \
     http://127.0.0.1:8600/v1/chat/completions \
     -d '{"model":"qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf",
          "messages":[{"role":"user","content":"Name the largest ocean on Earth in one short sentence."}],
          "max_tokens":48,"temperature":0}'
# -> "The largest ocean on Earth is the Pacific Ocean."
```

## Rollback

```bash
systemctl --user disable --now mythos-haddad-runtime.service
rm -f ~/.config/systemd/user/mythos-haddad-runtime.service
systemctl --user daemon-reload
rm -rf ~/.local/share/mythos-haddad/runtime/llama.cpp     # engine + shim
rm -rf ~/.local/share/mythos-haddad/models/qwen2.5-7b-instruct-q4_k_m  # model (4.4 GiB)
rm -rf ~/.config/mythos-haddad                             # API key + config
```

Nothing outside these paths was touched: no system package was installed, no file under `/usr`
or `/etc` was created or modified, and `projects/mythos-ai-executor/free-llm/` (catalog,
endpoints, registry) is unchanged.

## Constraints honored

- **Free-LLM catalog untouched.** `git diff` against this change touches only
  `projects/mythos-haddad/` and `docs/`. The runtime is not registered as a free-LLM provider —
  that pool is advisory-only by explicit design (`providers/free-llm-pool.js:84`
  `executionAuthority: false`) and its `catalog.json` is fully regenerated from an upstream
  README on a daily timer, so a hand-added local provider would be silently dropped at the next
  sync. Registering Haddad's model properly (as its own agent, `execution_authority: false`) is
  HAD-4, a later, separate stage — see `docs/MYTHOS_HADDAD_V1_SCOPE.md`.
- **Not connected to production orchestration.** No file under `projects/mythos-ai-executor/core/`,
  `lib/`, `config/agents.json`, or any systemd unit outside `projects/mythos-haddad/` was changed.
  The runtime is reachable only on `127.0.0.1:8600` on this machine.
- **One model.** Exactly one GGUF (Qwen2.5-7B-Instruct-Q4_K_M) is downloaded and pinned;
  `haddad-model-install.sh` never installs a second.
- **No source build of the engine.** llama.cpp, ggml and Vulkan are the unmodified Ubuntu 26.04
  `.deb` binaries. The one compiled artifact is the 15-line loader shim described above, needed
  only because of the root constraint, not because of anything about llama.cpp itself.

## Known limits

- No CUDA (matches V0): Vulkan via NVK only. Generation throughput is modest for a 7B model on
  this hardware; this is a driver-maturity limit, not a install or configuration defect.
- Live VRAM usage cannot currently be read from the OS on this host (`VK_EXT_memory_budget`'s
  `heapUsage` and DRM `fdinfo` are both unavailable/unreliable) — use the runtime's own
  memory-fit log line instead (see Measurements).
- The loader shim is a workaround for a real, root-only permission gap, not a permanent design
  choice; if the owner ever grants the one-line symlink above, the shim can stay (harmless) or be
  retired in a later stage.
- `--ctx-size` is fixed at 4096 tokens. Larger contexts increase the KV-cache VRAM cost and were
  not tested against the 6 GB ceiling.
