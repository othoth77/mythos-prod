# Free LLM Resources

Discovery, health-check, selection and A→B→C fallback across free-tier LLM
providers. Full architecture: `docs/MYTHOS_FREE_LLM_RESOURCES.md`.

```
node bin/free-llm-sync.js [--dry-run]        # refresh catalog.json from the upstream README
node bin/free-llm-health.js [provider-id]    # probe one or every provider
node bin/free-llm-status.js [--json]         # print the full service/model registry
```

Add a credential at `~/.config/mythos-ai-executor/free-llm/<provider-id>.env`
(`MYTHOS_FREE_LLM_<PROVIDER_ID>_API_KEY=...`) before a provider can be
selected for a real call — every provider reports `unconfigured` until then.

## One-shot completion for other processes — `bin/free-llm-complete.js`

A thin CLI over `selector.complete()` (same catalog, keys, health ranking and
A → B → C fallback) for consumers that are not part of this Node process.
First consumer: the Ads Mythos dashboard (short read-only explanations).

```bash
echo '{"system":"…","prompt":"…","exclude":["groq"],"timeout_ms":20000}' \
  | node free-llm/bin/free-llm-complete.js --state-dir /abs/private/dir
# → {"ok":true,"text":"…","provider_id":"…","model_id":"…","attempts":[{provider_id,status,timed_out,http_status}]}
```

- `only` / `exclude` restrict the candidates (e.g. "pool without groq", then
  "groq only" as an explicit fallback step).
- `--state-dir` keeps the consumer's health + reputation ledgers private
  (seeded from the shared health file, which is only read) — a sandboxed
  consumer never writes into the executor store.
- Output never contains a key, a request header or a provider's error text;
  exit 0 = a JSON answer was written (ok true/false), 2 = bad input.
- Tests: `tests/free-llm-complete-cli-test.js` (offline, injected transport).
