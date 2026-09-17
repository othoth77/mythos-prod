# MYTHOS Guardian — incidents

## Where

| File | Content | Bound |
|---|---|---|
| `/var/lib/mythos-guardian/incidents.jsonl` | one JSON incident per line | rotates at 5 MB, keeps `.1`–`.3` (≤ 20 MB) |
| `/var/lib/mythos-guardian/last-incident.json` | newest incident, overwritten | one record; survives a failed ledger append |
| `/var/lib/mythos-guardian/state.json` | levels, hysteresis counters, budgets, cooldowns | overwritten |
| `/var/lib/mythos-guardian/public/status.json` | public status read by the Status Center | overwritten |
| `journalctl -u mythos-guardian` | one summary line per tick | journald cap (500 M) |

All files are root-only (`0700` state dir). Values matching password, secret, token, api_key or authorization patterns are redacted before writing.

## When an incident is written

- a domain's **confirmed** level changes (never on a raw sample);
- an action **executes** (success or failure);
- an action is planned but **not** executed because its marker is absent or a config error refused it. This is recorded at most once per cooldown window per action, so observe mode stays quiet;
- configuration becomes invalid.

## Record (OTH protocol)

```json
{
  "id": "GI-20260914T031200-001",
  "time": "2026-09-14T03:12:00.000Z",
  "severity": "HIGH",
  "domain": "services",
  "trigger": "command-center FAILED",
  "evidence": { "...": "domain summary / kernel OOM lines / verified paths" },
  "affected": ["command-center"],
  "action": ["service:command-center:execute"],
  "before": "NORMAL",
  "after": "HIGH",
  "result": "level escalation",
  "production_impact": "production/critical affected: command-center",
  "remaining_risk": "services remains HIGH until evidence clears (hysteresis)",
  "next_action": "journalctl for the affected unit; fix the cause before resetting a DEGRADED unit",
  "mode": "enforcing: service-recovery",
  "oth": "[GUARDIAN INCIDENT]\nTime: …\nSeverity: …\nTrigger: …\nEvidence: …\nAction: …\nResult: …\nProduction impact: …\nRemaining risk: …\nNext action: …"
}
```

```bash
jq -r .oth /var/lib/mythos-guardian/incidents.jsonl | tail -n 40
jq -c 'select(.severity=="CRITICAL" or .severity=="EMERGENCY")' /var/lib/mythos-guardian/incidents.jsonl
```

## Evidence retention

- **OOM:** on a memory transition caused by an oom_kill delta, and before any journal vacuum, the last 15 minutes of kernel OOM lines (≤ 200) are copied into the incident. Rotated `/var/log` archives were purged by a session on 2026-09-13, so this copy is the durable record.
- Incidents are never deleted by Guardian. Rotation keeps about the last 20 MB. Archive `incidents.jsonl.3` off-host before it would be overwritten if longer history is needed.
