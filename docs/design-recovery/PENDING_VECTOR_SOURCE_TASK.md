# PENDING TASK — Mythos original logo: vector / master source investigation

**Tracked as:** **LOGO-1** in `docs/MYTHOS_DESIGN_DECISIONS.md` §3.1
**Raised by:** `docs/design-recovery/MYTHOS_ORIGINAL_LOGO_RECOVERY.md` §7
**Recorded as a pending task:** 2026-08-18, on owner instruction
**Status:** **PENDING — NOT STARTED.** Blocked on environment access, not on a decision.

---

## 1. The question

**Does an original vector or layered master source of the Mythos logo exist
outside the current Git history?**

This is a question of fact, not of design. It is not answerable from the
repository: the recovery audit established, across the full unshallowed history
(438 commits, 36 branches), that **no `.svg`, `.pdf`, `.ai` or `.eps` file has
ever been tracked in `mythos-prod`**. The only Mythos identity artifacts in Git
are two raster PNGs.

## 2. Why it matters

- The Stage 1B masters (`assets/brand/`) are a **reconstruction measured from a
  raster**. They are PROPOSED and unapproved (decision **A-007**).
- If a true vector or layered original is found, the reconstruction must be
  **diffed against it before any master is adopted** (decision **LOGO-2**).
- If none is found, that negative result is itself the finding, and it should be
  recorded with the same rigour as a positive one — it is what would justify the
  reconstruction becoming the master.

## 3. Where to look, in priority order

Locations identified by the recovery audit. None was reachable from the sessions
that produced Stages 1B-PREP, 1B or 1A.

| # | Location | Why it is a candidate |
|---|---|---|
| 1 | `VPS_TRANSFER/Mythos/` | The package the two recovered PNGs themselves came from, SHA-256 verified 2,241/2,241 on receipt |
| 2 | `VPS_TRANSFER/Mythos/MythosProd-unversioned/` | A 143-file snapshot of this application under an earlier branding. **Also contains sensitive material** — see §5 |
| 3 | Off-host snapshot repositories: `othoth77/mythos-prod-unversioned-snapshot` (127 files), `othoth77/mythos-app` (8 files) | Independent off-host copies of the same snapshot class, per `docs/OFFHOST_PROJECT_REGISTRY.md` |

## 4. Method

1. Search the three locations for `svg`, `pdf`, `ai`, `eps`, `psd`, `sketch`,
   `fig`, `cdr`, and any layered raster (`xcf`, layered `tif`).
2. For every candidate: record path, format, dimensions, size, **SHA-256**,
   whether it is genuinely vector, and its relationship to
   `logomythos.png` / `logo.png`.
3. Compare any find against the Stage 1B reconstruction — slant angle, stem
   weights, letter widths, gaps, S geometry — and record the deltas.
4. Record the outcome in `MYTHOS_ORIGINAL_LOGO_RECOVERY.md` and close
   **LOGO-1** in the decision register.
5. **If nothing is found, record that explicitly**, naming the locations
   searched and the search terms used, so the negative result is auditable.

## 5. Constraints — binding

- **Read-only.** Do not modify, move, rename, delete or overwrite anything in
  `VPS_TRANSFER` or any snapshot. The audit's guarantee that "nothing was
  deleted, modified, moved, or renamed" must survive this task.
- **No external repository may be contacted** unless credentials and access are
  available **and explicitly authorised**. The off-host repositories are private
  and no credential for them existed in any session so far. Absence of access is
  a blocker to report, never a reason to improvise.
- **`MythosProd-unversioned` contains sensitive files** — a company RIB, a
  national identity number (CIN), embedded client records and a live data
  backup, per `docs/OFFHOST_PROJECT_REGISTRY.md`. **None of it may reach GitHub,
  private or otherwise.** Search it for image formats only; do not open, copy,
  quote or commit its records.
- **Do not redraw the logo** as part of this task. This is an investigation, not
  a design step (decision **A-007**).

## 6. What would close this task

Either outcome closes it, provided the evidence is recorded:

- **A source is found** → catalogued with SHA-256, diffed against the 1B
  reconstruction, recorded in the recovery document. **LOGO-1** closed;
  **LOGO-2** becomes decidable.
- **No source is found** → the searched locations, formats and terms are
  recorded. **LOGO-1** closed as a negative finding; **LOGO-2** becomes
  decidable on the reconstruction alone.

## 7. Environment required

A session with **VPS filesystem access** (for locations 1–2) and, for location 3,
**explicitly authorised credentials** for the private off-host repositories. The
cloud container sessions that produced Stages 1B-PREP, 1B and 1A had neither:
`/home/ubuntu/incoming/VPS_TRANSFER`, `/var/www` and `/srv` do not exist there.
