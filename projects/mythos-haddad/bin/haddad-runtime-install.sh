#!/usr/bin/env bash
# =====================================================
# MYTHOS HADDAD — HAD-2: local AI runtime install (llama.cpp, Vulkan backend)
# projects/mythos-haddad/bin/haddad-runtime-install.sh
#
# Installs llama.cpp's Vulkan backend WITHOUT root and WITHOUT building
# llama.cpp (or ggml, or Vulkan itself) from source. `apt install` needs
# root, which this account does not have non-interactively (see README,
# Setup). Instead this script:
#
#   1. `apt-get download`s the four distro .deb packages that `apt install
#      llama.cpp-tools libggml0-backend-vulkan` would pull in. `apt-get
#      download` needs no root and goes through the same GPG-verified APT
#      transport as a normal install — the packages are not "untrusted",
#      they are the same signed Ubuntu archive content, just unpacked to a
#      user prefix instead of /usr.
#   2. Unpacks them with `dpkg-deb -x` into a user-local prefix
#      (~/.local/share/mythos-haddad/runtime/llama.cpp). This skips
#      maintainer scripts (none are needed: nothing here creates a system
#      user or touches ldconfig's system cache), so this script recreates
#      the two soname symlinks ldconfig would normally have made.
#   3. Builds ONE tiny (~15-line) loader shim — see "Why this shim exists"
#      below — and installs thin wrapper scripts that use it.
#
# Idempotent: safe to re-run. Rollback: delete the prefix (see README).
#
# ---------------------------------------------------------------------
# Why this shim exists (verified on this host with strace, not assumed):
#
# ggml's backend-plugin loader (`ggml_backend_load_all()`, compiled into
# libggml.so at Debian package-build time) always probes ONE HARDCODED
# ABSOLUTE PATH for every known backend name: /usr/lib/x86_64-linux-gnu/
# ggml/backends0/lib{cpu,vulkan,cuda,...}.so — regardless of any
# environment variable. That path is root-owned 0755 with nothing
# unprivileged able to write to it, and doesn't exist at all on a host
# that never had a system-wide `apt install` of these packages (confirmed
# with `touch` and `strace -e openat,newfstatat`; every candidate comes
# back ENOENT).
#
# ggml's one override, GGML_BACKEND_PATH, loads exactly ONE extra .so file
# per process — enough for Vulkan alone, but llama.cpp also needs a CPU
# backend registered even for a fully GPU-offloaded model (used for the
# host-side staging buffer during weight loading); without it llama-server
# fails immediately with "no CPU backend found".
#
# No unprivileged path around this exists on this host: unprivileged user
# namespaces (`unshare --user --map-root-user`, and `bwrap`) are both
# blocked here by kernel/AppArmor policy (verified: both fail with
# "Operation not permitted" / a read-only-filesystem error trying to
# shadow /usr), and LD_PRELOAD-ing both backend .so files does not make
# them self-register into ggml's registry (verified: --list-devices still
# reports no devices).
#
# So: GGML_BACKEND_PATH points at this shim instead of directly at a
# backend. Its constructor calls the exact same public entry point ggml's
# own scanner would have called — `ggml_backend_load(path)` — once per
# path named in MYTHOS_EXTRA_GGML_BACKENDS, landing both backends in the
# identical process-wide registry. It contains no llama.cpp or ggml code;
# it links against the unmodified distro libggml.so.0 and calls one
# documented public function from it, twice. Rollback is deleting one
# 16 KB .so file, same as the rest of the prefix.
#
# The one real alternative was a single root-owned symlink
# (/usr/lib/x86_64-linux-gnu/ggml -> this prefix's backends0 directory),
# which is simpler but needs root this account does not have. If that
# access is ever granted, this shim becomes unnecessary — ggml's own
# unmodified scanner would find both backends directly — but nothing here
# depends on making that call.
# =====================================================
set -euo pipefail

PREFIX="${HADDAD_RUNTIME_PREFIX:-$HOME/.local/share/mythos-haddad/runtime/llama.cpp}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { printf '[haddad-runtime-install] %s\n' "$*"; }

for c in apt-get dpkg-deb gcc; do
  command -v "$c" >/dev/null || { say "MISSING: $c"; exit 1; }
done

# Pinned by upstream Ubuntu archive version, not by us — reproducibility
# comes from the archive's own GPG-verified Packages index, the same
# guarantee `apt install` would give.
PACKAGES=(llama.cpp-tools libllama0 libggml0 libggml0-backend-vulkan)

say "downloading ${PACKAGES[*]} via apt-get download (no root, GPG-verified archive)"
( cd "$WORK" && apt-get download "${PACKAGES[@]}" )

say "unpacking into $PREFIX"
rm -rf "$PREFIX"
mkdir -p "$PREFIX"
for deb in "$WORK"/*.deb; do
  dpkg-deb -x "$deb" "$PREFIX"
done

LIBDIR="$PREFIX/usr/lib/x86_64-linux-gnu"
LLAMADIR="$LIBDIR/llama"
BACKENDS="$LIBDIR/ggml/backends0"

say "recreating soname symlinks (normally made by ldconfig on a real apt install)"
ln -sf "$(basename "$(ls "$LIBDIR"/libggml-base.so.*)")" "$LIBDIR/libggml-base.so.0"
ln -sf "$(basename "$(ls "$LIBDIR"/libggml.so.*)")"      "$LIBDIR/libggml.so.0"
ln -sf "$(basename "$(ls "$LLAMADIR"/libllama.so.*)")"   "$LLAMADIR/libllama.so.0"
ln -sf "$(basename "$(ls "$LLAMADIR"/libmtmd.so.*)")"    "$LLAMADIR/libmtmd.so.0"

say "building the backend-loader shim (see header — no llama.cpp/ggml code, one distro lib linked)"
mkdir -p "$PREFIX/lib"
gcc -shared -fPIC -O2 \
  -o "$PREFIX/lib/libhaddad-backend-loader.so" \
  "$(dirname "${BASH_SOURCE[0]}")/../src/backend-loader-shim.c" \
  -L"$LIBDIR" -Wl,-rpath,'$ORIGIN/../usr/lib/x86_64-linux-gnu' -l:libggml.so.0

say "probing which CPU backend variant this CPU actually supports"
export LD_LIBRARY_PATH="$LIBDIR:$LLAMADIR"
CPU_BACKEND=""
# Ordered by how much of this ~2017-era AMD Zen 1 CPU's instruction set
# each variant assumes, most specific (fastest, if supported) first.
for cand in zen4 skylakex icelake haswell sandybridge sse42 x64; do
  cand_path="$BACKENDS/libggml-cpu-$cand.so"
  [ -f "$cand_path" ] || continue
  out="$(GGML_BACKEND_PATH="$cand_path" "$PREFIX/usr/bin/llama-cli" --list-devices 2>&1 || true)"
  if printf '%s' "$out" | grep -q "loaded CPU backend from $cand_path"; then
    CPU_BACKEND="$cand_path"
    say "  using libggml-cpu-$cand.so"
    break
  fi
done
[ -n "$CPU_BACKEND" ] || { say "FAILED: no CPU backend variant is supported on this CPU"; exit 1; }
echo "$CPU_BACKEND" > "$PREFIX/lib/cpu-backend-path.txt"

say "installing wrapper scripts"
mkdir -p "$PREFIX/bin"
for tool in llama-server llama-cli llama-bench llama-quantize; do
  cat > "$PREFIX/bin/$tool" <<WRAPPER
#!/usr/bin/env bash
# Generated by haddad-runtime-install.sh — do not edit by hand, re-run the
# installer instead. See projects/mythos-haddad/docs/AI_RUNTIME.md.
set -euo pipefail
PREFIX="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
export LD_LIBRARY_PATH="\$PREFIX/usr/lib/x86_64-linux-gnu:\$PREFIX/usr/lib/x86_64-linux-gnu/llama\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
export MYTHOS_EXTRA_GGML_BACKENDS="\$(cat "\$PREFIX/lib/cpu-backend-path.txt"):\$PREFIX/usr/lib/x86_64-linux-gnu/ggml/backends0/libggml-vulkan.so"
export GGML_BACKEND_PATH="\$PREFIX/lib/libhaddad-backend-loader.so"
exec "\$PREFIX/usr/bin/$tool" "\$@"
WRAPPER
done
chmod +x "$PREFIX"/bin/*

say "verifying: both backends load and the GPU is enumerated"
devices="$("$PREFIX/bin/llama-cli" --list-devices 2>&1)" || true
printf '%s\n' "$devices"
printf '%s\n' "$devices" | grep -q 'Vulkan' \
  || { say "FAILED: no Vulkan device listed"; exit 1; }

say "done. Binaries: $PREFIX/bin/{llama-server,llama-cli,llama-bench,llama-quantize}"
say "next: haddad-model-install.sh, then the mythos-haddad-runtime systemd unit"
