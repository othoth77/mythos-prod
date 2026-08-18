# `migration-staging/` — transient, delete after publication

**This directory is not part of Mythos OS and must not be treated as source.**

It holds one thing: `idauto-standalone/`, the complete, validated content of the new
standalone IDauto repository, staged here **only** because the repository it belongs in
(`othoth77/idauto`) does not exist yet and this working environment is ephemeral.

Losing the work was the alternative. Staging it on this branch was not.

---

## Why it is here

The ID Auto standalone migration was completed and validated on 2026-08-18:

- 88 files migrated and decoupled
- All 13 test suites re-run in the new layout against a live PostgreSQL 16 database:
  **601 assertions, 0 failures**
- Full audit in `idauto-standalone/docs/MIGRATION_AUDIT_REPORT.md`

Publication is blocked on one thing only: **`othoth77/idauto` does not exist**, and this
session's GitHub integration cannot create it —
`POST /user/repos` returns `403 Resource not accessible by integration`. Repository creation
needs an account-administration permission the integration does not hold.

## How to publish it

1. **Create an empty `othoth77/idauto`** on GitHub — no README, no `.gitignore`, no licence.
   The migrated tree must be the repository's authoritative first content.
2. Grant the working session access to it.
3. Push the staged tree as the repository's initial commit.
4. Open the standalone PR (see `docs/IDAUTO_STANDALONE_MIGRATION.md` §5 for the intended
   body).
5. **Delete this directory** from `othoth77/mythos-prod` in the same change that adds the
   pointer document.

## What must NOT happen

- Do **not** treat `idauto-standalone/` as a live source tree. It is a snapshot.
- Do **not** edit it here. Edit it in `othoth77/idauto` once that exists.
- Do **not** remove `projects/idauto/`, `docs/IDAUTO_*.md` or `tests/ida-*.js` from this
  repository yet. Until the standalone repository is published, this snapshot and the
  original are the only copies, and the original is the one with real Git history.

The source-repository cleanup is a **separate, later** change. Its full plan — what is
removed, what pointer stays, and why it has not been executed — is in
`docs/IDAUTO_STANDALONE_MIGRATION.md`.
