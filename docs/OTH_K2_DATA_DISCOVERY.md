# OTH-K2 — Real-Data Discovery Evidence (2026-08-19)

**Scope of search (authorized surfaces only):**
1. This execution environment's filesystem (repository, `/workspace`, home) — full scan for Takeout/Gemini/NotebookLM/contacts export patterns.
2. The owner-connected Google Drive connector (claude.ai connector, authorized by the owner for this session) — targeted title searches + recent-files sweep.

No other locations were probed. No content was printed to logs; this table
holds metadata only.

## Evidence table

| Source class | Artifact | Format | Size | Date | Origin | Privacy class | Parser available | Import status | Reason if blocked |
|---|---|---|---|---|---|---|---|---|---|
| google-takeout | — none found — | (zip/dir expected) | — | — | local scan + Drive title search `takeout` | — | YES (importer, fixture-proven) | **BLOCKED — source absent** | No Takeout archive exists in any authorized location; owner must produce one (takeout.google.com) and supply the extracted archive |
| gemini | — none found — | (JSON/MD export expected) | — | — | Drive title search `gemini` | — | YES (importer, fixture-proven) | **BLOCKED — source absent** | No Gemini export exists in authorized locations |
| notebooklm | — none found — | (notes/text expected) | — | — | Drive title search `notebooklm` | — | YES (importer, fixture-proven) | **BLOCKED — source absent** | NotebookLM has no automatic export to Drive; owner must export manually |
| google-contacts | `contacts gmail .csv` | text/csv | 495,257 B | 2021-01-02 | Drive id `1M02qd5FcQD9cO_aTFMKrmELOj1rn_kD3` | **third-party PII** | YES (contacts importer) | **METADATA-ONLY** (aggregates imported) | Class policy is metadata-only (D1-deferential, fail-closed); content import requires an explicit owner decision |
| google-contacts | `contacts iphone.csv` | text/csv | 135,889 B | 2021-01-02 | Drive id `1JpI_bB66jXQhy4RsOw23a6urcfz1ECtY` | **third-party PII** | YES | **METADATA-ONLY** (aggregates imported) | Same policy |
| google-contacts | `contacts gmail ` (Sheet) | Google Sheet | n/a (export) | 2021-01-02 | Drive id `1kK6utscSZdR8g6Iu1OEcq0xkCayNebwbXuDuD6Gy0iA` | third-party PII | YES (via CSV export) | **METADATA-ONLY**; duplicate-suspect of the CSV | Same policy; likely same corpus as `contacts gmail .csv` (same date) — recorded as possible duplicate, never merged blindly |
| google-other | Owner Google Docs corpus (e.g. `اتفاق مبدئــي - ميتوس`, `Mouain`, CNSS letter, untitled docs) | Google Docs → text export | 7 KB–1.3 MB each | 2024–2026 | Drive recent-files sweep, owner-owned | private business documents | YES (Drive text export → manual/google-other ingest) | **BLOCKED — content transfer denied** | The session's permission policy (auto-mode classifier) denied Drive content download on 2026-08-19; discovery/metadata access works, content access does not. Real import is operator-executable: export the docs locally and run `othk-cli.js ingest <file> --class google-other`. Durable storage additionally needs a persistent private store (never Git) |
| google-other | `Trade history` (Sheet), `Facture Mythos Prod.xlsx`, `Candidatures FIXPERT` (shared) | Sheets/XLSX | 5–64 KB | 2016–2026 | Drive sweep | private business/financial | CSV export: YES; XLSX binary: NO (no XLSX parser in zero-dep layer) | XLSX **BLOCKED — parser unavailable**; Sheets ingestable via CSV export | XLSX parsing needs a dependency decision; not justified yet |
| manual | (future owner-supplied documents) | md/txt/json/html/csv | — | — | — | varies | YES | READY | Awaiting documents |

## Findings

1. **The expected "big three" exports (Takeout, Gemini, NotebookLM) do not
   exist** in any authorized location. Their importers are therefore built
   and proven against deterministic fixtures that mirror the real formats,
   with real ingestion recorded as externally blocked — not fabricated.
2. **Real Google Contacts exports exist** (2021 vintage). The class policy
   (metadata-only, fail-closed, deferential to the ecosystem's ratified
   third-party-PII stance) permits aggregate metadata import only: row
   counts, column structure, file hashes, dates. No name, phone number, or
   email enters the knowledge store, logs, or Git.
3. **Real owner documents exist** in Drive (google-other class), but a
   content-download attempt on 2026-08-19 was **denied by the session's
   permission policy** (auto-mode classifier) — a genuine external
   boundary, not worked around. Metadata discovery works; content
   transfer does not. The end-to-end real-data path is proven against
   format-faithful fixtures instead, and the operator can run the real
   import locally with the CLI (no code change needed).
   For contacts, content transfer through session logs would additionally
   expose third-party PII wholesale, so even with permission it would be
   refused here; the metadata-only importer takes a local file path.
4. **Durable real-data storage is an external blocker**: private content
   must never enter this repository, and this execution environment is
   ephemeral. A persistent private store location (VPS directory or private
   object storage) is an owner/operator provisioning decision, recorded in
   `docs/OTH_KNOWLEDGE_OPERATIONS.md`.
5. PDF and XLSX artifacts remain unsupported by the zero-dependency parser
   set; recorded as a future dependency decision, not silently skipped.

## Phase 16 probe (same session)

`51.68.226.211:22` unreachable from this environment; no ssh/scp/rsync
binaries; no keys. AI-agent→VPS access remains **NOT AVAILABLE** —
unchanged from the OTH-K1 record.
