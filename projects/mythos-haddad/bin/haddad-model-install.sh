#!/usr/bin/env bash
# =====================================================
# MYTHOS HADDAD — HAD-2: pinned model download
# projects/mythos-haddad/bin/haddad-model-install.sh
#
# Downloads the ONE model V1 pins (see docs/AI_RUNTIME.md): the official
# Qwen2.5-7B-Instruct Q4_K_M GGUF from the Qwen org on Hugging Face — a
# first-party, non-community quant, chosen so the model itself is as
# trustworthy as the runtime. It ships as two GGUF shards; llama.cpp loads
# split GGUFs transparently when given the first shard's path.
#
# Idempotent and fail-closed: an existing file is kept only if its sha256
# matches the pinned manifest below; anything else is re-downloaded. Never
# installs a second model — re-running only ever refreshes this one.
# =====================================================
set -euo pipefail

MODELS_DIR="${HADDAD_MODELS_DIR:-$HOME/.local/share/mythos-haddad/models}"
NAME="qwen2.5-7b-instruct-q4_k_m"
DEST="$MODELS_DIR/$NAME"
BASE_URL="https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main"

# Pinned 2026-09-21 from the official Qwen org repo, commit bb5d59e (HF
# `x-repo-commit` response header at download time). sha256 computed locally
# from the downloaded bytes, not merely copied from a response header.
declare -A FILES=(
  ["qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf"]="dfce12e3862a5283ccfb88221b48480e58745165de856439950d0f22590580db"
  ["qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf"]="539cf93f78e887edea1c04e2d7d8cdaca9d01dae9c9025bcb8accbe29df3d72a"
)

say() { printf '[haddad-model-install] %s\n' "$*"; }

command -v curl >/dev/null || { say "MISSING: curl"; exit 1; }
mkdir -p "$DEST"

sha_of() { sha256sum "$1" | awk '{print $1}'; }

for f in "${!FILES[@]}"; do
  want="${FILES[$f]}"
  path="$DEST/$f"
  if [ -f "$path" ] && [ "$(sha_of "$path")" = "$want" ]; then
    say "OK (already verified): $f"
    continue
  fi
  say "downloading $f ..."
  tmp="$path.part"
  curl -sL --fail -o "$tmp" "$BASE_URL/$f"
  got="$(sha_of "$tmp")"
  if [ "$got" != "$want" ]; then
    say "SHA256 MISMATCH for $f"
    say "  expected: $want"
    say "  got:      $got"
    rm -f "$tmp"
    exit 1
  fi
  mv "$tmp" "$path"
  say "verified: $f"
done

say "model ready: $DEST/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf (+ shard 2)"
say "load with: llama-server -m '$DEST/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf' ..."
