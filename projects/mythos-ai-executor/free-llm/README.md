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
