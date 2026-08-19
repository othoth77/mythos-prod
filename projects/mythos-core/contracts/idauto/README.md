# IDauto protocol vocabularies — pinned copies

The three `.v1.json` files in this directory are **verbatim copies** of published
IDauto protocol vocabulary artifacts (`othoth77/idauto`, `protocol/vocabularies/`).
ID Auto defines these vocabularies; Mythos adopts them. **Never edit these files
in place.** `PINS.json` records the upstream commit, branch and a SHA-256 digest
for each file, computed over raw bytes. `tests/mythos-identity-core-0-contract-test.js`
verifies every digest before it trusts anything parsed from these files.

Digests are computed over **raw bytes**, which is why this directory also carries
`.gitattributes` forcing `text eol=lf` on every `.json` file here — a CRLF
conversion, a BOM, or a non-UTF-8 re-save would change the bytes and silently
invalidate the pin. Do not remove `.gitattributes` or edit these files with a
tool that might normalize line endings.

## Re-pin procedure

A change to any file in this directory is legitimate **only** through this
six-step procedure. There is deliberately **no script** that updates
`PINS.json` automatically — a script that silently re-pins on drift would turn
the drift *detector* this suite implements into a drift *recorder*, which
defeats the entire point of pinning.

1. Confirm the change merged upstream in `othoth77/idauto` and that upstream's
   own conformance suite is green against it.
2. Copy the new bytes from the upstream artifact into this directory,
   overwriting the old file exactly (`cp`, not a hand edit).
3. Update `PINS.json` by hand: the affected artifact's `sha256`, `version` and
   `revision`, and the top-level `upstream.commit`. Update `pinned_at`. Add a
   note in the commit message naming the IDauto commit that was re-pinned.
4. If the vocabulary's active value *set* changed, update the corresponding
   constant in `projects/mythos-core/reference/identity-contract.js`
   (`ACTOR_TYPES` and/or `ORG_ROLES`).
5. Run `node tests/mythos-identity-core-0-contract-test.js`. Between step 3 and
   step 4, if the set changed, the suite **must FAIL** — that failure is the
   proof the drift detector works. After step 4, it must pass.
6. Record the re-pin in `docs/AI_HANDOVER.md` and in
   `docs/MYTHOS_IDENTITY_ARCHITECTURE.md` §12.

Skipping any step, or writing a script that performs steps 2-3 automatically,
defeats the purpose of pinning: the whole design assumes a human reads and
authorises every change to the bytes these tests trust.
