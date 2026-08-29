# OTHMODE gateway compression pipeline

**Status:** live · **Verified:** 2026-08-28 · **Gateway:** OmniRoute 3.8.49

OTHMODE sends every advisory LLM request through OmniRoute with a single
compression selection. Compression happens **once**, at the gateway. The
executor deliberately does not compress before sending.

```
OTHMODE task
  → core/context.js          relevance retrieval + budgeting ONLY (never compression)
  → providers/openai-compat.js   sends x-omniroute-compression: othmode-headroom
  → OmniRoute combo `othmode-headroom`
       → headroom   lossless tabular compaction of homogeneous JSON arrays
       → rtk        terminal / tool-output filtering
       → caveman    prose rules
  → model
```

`preserveSystemPrompt=true` is set gateway-side, so system and developer
instructions are never rewritten.

## Selecting the combo

`providers/openai-compat.js` defaults to `othmode-headroom` and honours an
override:

```bash
MYTHOS_OMNIROUTE_COMPRESSION=off   # send uncompressed (used for before/after measurement)
```

This is a **named combo**, not a model or provider binding, so provider
flexibility is preserved.

## ⚠ Upstream-bug workaround — READ BEFORE UPGRADING OmniRoute

OmniRoute 3.8.49 acknowledges the `x-omniroute-compression` header (the response
echoes `source=request-header`) but **does not dispatch the named combo**. Every
request silently falls back to the built-in `default-caveman` pipeline.

**Cause** — `open-sse/handlers/chatCore.ts`. A header combo raises the mode to
`stacked`; the default-combo installer guards on mode, routing combos, the active
profile and the engines map **but never checks the request header**, so it installs
`default-caveman`, setting `compressionComboApplied` and `config.compressionComboId`.
The later block that would install the header's pipeline is guarded by
`!compressionComboApplied && !config.compressionComboId` — now both false — so the
header pipeline is discarded. This contradicts the official `COMPRESSION_GUIDE.md`,
which states the header "beats … the panel Default". The identical guards are
present in upstream `release/v3.8.49` **and `main`** — this is not fixed in a newer
release.

**Workaround in force** — one settings row in the OmniRoute database:

```
namespace = compression
key       = stackedPipeline
value     = [{"engine":"rtk","intensity":"standard","config":{}},{"engine":"caveman","intensity":"full"}]
```

This row was previously **absent**, so the value defaulted to exactly
`[rtk(standard), caveman(full)]` — the single shape `isBuiltinStackedPipeline()`
matches. The empty `config:{}` makes that predicate false, which skips the
default-combo installer and lets the header combo dispatch. The pipeline is
otherwise identical to the built-in fallback, so fallback behaviour is unchanged.

**On any OmniRoute upgrade:**

1. Do **not** assume this still works — the workaround depends on an internal predicate.
2. Re-verify with `compression_engine_breakdown` (below), never with the response header.
3. If upstream fixes the dispatch bug, this row can be deleted; confirm by breakdown first.
4. To revert: delete that one `key_value` row.

## Verifying (the response header is NOT proof)

`X-OmniRoute-Compression: … source=request-header` only proves the header was
**read**, not that the named combo ran. The source of truth is the gateway database:

```sql
-- which engines actually executed, per request
SELECT engine, original_tokens, compressed_tokens, tokens_saved
FROM compression_engine_breakdown
WHERE request_id = '<id>' ORDER BY id;

-- which combo was attributed
SELECT request_id, compression_combo_id FROM compression_analytics ORDER BY id DESC LIMIT 5;
```

A healthy OTHMODE request shows `headroom`, `rtk`, `caveman`.

## Measured savings (2026-08-28)

Savings depend entirely on payload shape — there is no single headline number.

| Workload | Before | After | Saved | % |
|---|---|---|---|---|
| Conversation / task | 141 | 121 | 20 | 14.2% |
| Large JSON / tool result | 8340 | 3330 | 5010 | 60.1% |
| Terminal / log output | 1798 | 1798 | 0 | 0.0% |
| Long context / history | 6565 | 4427 | 2138 | 32.6% |
| Coding task | 2559 | 2559 | 0 | 0.0% |

**Measured range: 0.0% – 60.1%.** Headroom does nearly all the work on structured
data; Caveman contributes on prose. RTK executes but has saved 0 tokens on every
payload measured so far.

## Paths that do NOT use this pipeline

| Path | Why |
|---|---|
| `providers/claude-code.js` | Spawns the Claude Code CLI, which talks to Anthropic directly. No `ANTHROPIC_BASE_URL` points at OmniRoute, so no gateway header applies. |
| `providers/gemini.js` | Direct HTTPS to Google with its own key; never reaches OmniRoute. Registered for `available()` health probes only — it never runs a task. |
| `providers/mock.js` | Test double, no network. |

Routing these through OmniRoute would be a global routing change and is out of
scope for this pipeline.

## Tests

`tests/othmode-compression-pipeline-test.js` — offline, deterministic (16 assertions).
Proves the advisory path sends the header, the planner shares that provider, no
second compression layer exists, the bypass paths stay honest, and a non-OTHMODE
request carries no compression header.
