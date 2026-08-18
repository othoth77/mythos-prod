# MYTHOS brand assets

**Status, updated 2026-08-18: the vector reconstruction is the ADOPTED
production master (AUTO-1 — delegated mandate, NOT owner-approved).** See
`docs/MYTHOS_DESIGN_DECISIONS.md` §0.5. No production file references anything
in this directory. Nothing here is deployed.

Specification: `docs/design/LOGO_SYSTEM.md`
Historical record: `docs/design-recovery/MYTHOS_ORIGINAL_LOGO_RECOVERY.md`

## Layout

```
assets/brand/
├── source/     canonical geometry + the generator (edit here)
├── master/     generated SVG masters (never hand-edit)
├── export/     generated PNG exports (never hand-edit)
├── tokens/     tokens.css — the canonical 1C/1E token artifact (AUTO-3, TOKEN-1)
│               NOT wired into any application or build
└── fonts/      8 self-hosted WOFF2 files + fonts.css (AUTO-4, TYPE-2)
                NOT wired into any application or build
```

`source/` is the only writable layer. `master/` and `export/` are build output:
regenerate them, do not patch them, or the system will drift.

## Regenerating

```bash
cd assets/brand/source
python3 build-masters.py          # SVG masters
python3 build-masters.py --png    # masters + PNG exports (requires cairosvg)
```

`build-masters.py` reads its geometry from `mythos-logo-geometry.py`, which is
the single source of truth for every letterform, weight and gap.

## Relationship to the historical assets

The historical logos under `assets/logos/` are **untouched and must stay that
way**. `logomythos.png` and `logo.png` are the recovered originals this
evolution was measured from; the other files there are non-Mythos client and
project logos. Nothing in this directory overwrites, replaces or supersedes
them — they remain the historical record regardless of what is approved here.
