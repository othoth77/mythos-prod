# Mythos Design Strategy

**Stage:** MYTHOS-DESIGN-RECOVERY-0
**Date:** 2026-08-17 UTC
**Baseline:** `main` @ `fcd899b`
**Companion:** `docs/MYTHOS_DESIGN_RECOVERY.md` (evidence), `docs/MYTHOS_DESIGN_DECISIONS.md` (register)

---

## 1. Purpose

**This is not a new design.** It is the strategic baseline extracted from design
work that already exists, so that when design work does begin it begins from what
was actually done rather than from memory.

Anything labelled **FUTURE** or **PROPOSED** is an option this document raises for
decision. It is **not** a historical decision and must never be cited as one.

## 2. Current design state

| Layer | State | Evidence |
|---|---|---|
| Mythos master brand | **Wordmark PNG only.** No specification of any kind | `assets/logos/logomythos.png`; no brand doc found |
| Mythos OS product UI | **Implemented and in use** — dark/gold, 252 tokens, 8 stylesheets, 72 JS modules | `css/`, `js/core/` |
| Shared design system | **Does not exist** | No token package, no component library, no cross-project import |
| Project brand kits | **One complete** (Uthina Chess). **One written but unimplemented** (Dar Hijama). All others absent | §4.2, §4.3 of the recovery document |
| `mythosprod.xyz` public hub | **Does not exist.** No apex vhost | `/etc/nginx/sites-available/` — only `panel`, `tv`, `ordre` subdomains |
| Design documentation | **This document is the first.** No prior design doc existed | 119 tracked `docs/` files, none design |

**The honest summary: Mythos has one implemented product design system, one
implemented project brand, one orphaned brand charter, and no master brand.**

## 3. Mythos brand architecture

The intended structure — Mythos → companies → public projects — is **not
implemented anywhere and not documented anywhere**. Evidence of it exists only as
the ecosystem list supplied to this audit, which is owner direction, not history.

What the evidence actually shows is a **flat portfolio**: independent projects,
each with its own domain, its own visual language, and no visible parent. Nothing
in any deployed site, stylesheet, or document identifies a project as belonging
to Mythos. There is no shared header, no endorsement mark, no "a Mythos project"
string anywhere in the tracked corpus.

**Status: INTENDED — NOT IMPLEMENTED.** See `MYTHOS_PROJECT_DESIGN_MATRIX.md` §3
for the confirmed-vs-intended comparison.

## 4. Mythos OS

The one mature design surface. **VERIFIED implemented.**

A dark application shell — near-black grounds stepped `#0e0e0e` → `#161616` →
`#1d1d1d` with a `#2a2a2a` border — carrying a single gold accent `#c9a84c` and
a warm off-white text `#e8e4dc`. Semantic colours (danger, green, blue, today,
past, purple) each pair a solid with a 12 %-alpha `-dim` companion, a consistent
and deliberate convention.

The `-dim` pairing is the **strongest evidence of systematic design thinking**
anywhere in the portfolio: it is applied uniformly across six semantic colours
and implies a state/background convention.

**Not recorded anywhere:** why gold, what the dark ground signifies, what
typography the system uses, what spacing scale governs it. The CSS is the only
specification, and it specifies colour but not type or rhythm.

## 5. Mythos companies

**UNKNOWN — no evidence recovered.** Mythos OS, Mythos Prod, Mythos Services,
Mythos Digital and Mythos Logistique appear in the ecosystem list supplied to
this audit. Searching the repository and VPS finds:

- **Mythos Prod** — the repository name and the initial-import commit subject
  (`d1a9d19`, "initial import of Mythos Prod"). VERIFIED as a name in use.
- **Mythos OS** — VERIFIED extensively: `docs/mythos-os-blueprint.md`,
  `docs/mythos-os-platform.md`, the portfolio registry's "Platform Core" row.
- **Mythos Services, Mythos Digital, Mythos Logistique** — **no evidence of any
  kind.** No document, directory, domain, asset, or commit mentions them.

No company has a logo, a brand, a domain, or a design of any kind.

## 6. Public projects

| Project | Domain | Served? | Design state |
|---|---|---|---|
| Uthina Chess | `uthinachess.tn` | **live** | Complete brand kit, implemented |
| SsangYong | `ssangyong.autos` | **live** | Implemented storefront ×2, no charter |
| Fixpert | `fixpert.tn` | **live** | Implemented site, no charter |
| NotreJour | `notrejour.tn` | **live** | Laravel/Vite app; 7 design files deferred, unplaced |
| Dar Hijama | `darhijama.tn` | **live (proxied app)** | Charter + 15 assets exist; **live site ignores them** |
| AgriBee | `agribee.tn` | **not served** | Site files + logo exist in transfer only |
| ID Auto | `idauto.tn` | **not served** | Internal admin UI only; no public site |
| Mouain | `mouain.tn` | **not served** | 1,787 lines of vision/pedagogy on an unmerged branch |

Full matrix: `docs/MYTHOS_PROJECT_DESIGN_MATRIX.md`.

## 7. Existing shared design DNA

**The honest finding: there is almost none.**

Four implemented stylesheets use four unrelated palettes, two colour schemes,
four radius scales and three incompatible variable-naming conventions. No file
imports another. No token is shared.

**What genuinely recurs — VERIFIED:**

1. **`:root` custom properties as the token mechanism.** All four stylesheets do
   this. It is a shared *technique*, not a shared *system* — the names disagree
   (`--bg`/`--text` · `--ink`/`--ground` · `--uc-black`/`--uc-gold`).
2. **Semantic colour pairing.** Mythos OS pairs each semantic colour with a
   12 %-alpha `-dim`; Command Center pairs each with a `-soft`. Same idea, two
   vocabularies, arrived at independently.
3. **Inter as body typeface.** Appears in Mythos OS's Uthina kit, ID Auto,
   Dar Hijama's charter and Uthina's charter. **The single most consistent design
   choice across the portfolio** — and it is nowhere written down as a decision.
4. **Arabic/Latin bilingual typography.** Both written charters specify separate
   Arabic and Latin stacks. Command Center ships an `i18n.js` of 464 lines.
   Bilingual capability is real and recurring.
5. **Gold on dark.** Mythos OS `#c9a84c` and Uthina Chess `#D9A441`. Two
   projects, two near-identical strategies, no recorded relationship.

**INFERRED, not decided:** items 1–5 describe convergent practice, most likely
from a shared author working in a shared idiom. **None is a documented standard**
and none may be cited as an existing rule.

## 8. Brand independence vs Mythos consistency

**No decision on this exists — VERIFIED absent.**

The evidence is genuinely ambiguous, and that ambiguity is the finding:

- **Pointing to independence:** each project has a distinct palette; Uthina Chess
  has a fully realised identity owing nothing to Mythos; no project displays a
  Mythos mark.
- **Pointing to consistency:** the live Dar Hijama site uses the **Mythos gold
  `#c9a84c`** in preference to its own charter's green — a project reaching for
  the Mythos palette rather than its own.

That single data point is the strongest surviving evidence that some
Mythos-level visual identity was being applied in practice. Whether that was
intentional or convenient is **UNKNOWN**.

**This is the most consequential open question in the portfolio** and belongs to
the owner. It cannot be resolved from evidence.

## 9. UX principles already established

**One documented, one implemented, the rest absent.**

- **VERIFIED documented:** Uthina Chess page hierarchy — Hero (logo, title,
  countdown, CTA) → Details → Registration form, with named form fields.
- **VERIFIED implemented, never written:** SsangYong storefront IA — catalogue →
  category → product, with `garantie`, `cgv`, `confidentialite`, `a-propos`,
  `boutique` and a `pro/` area.
- **VERIFIED as practice:** headless-browser visual verification was performed on
  SsangYong and found three real layout defects (`1bcba2c`, recorded `00a70b2`).
  A precedent for design QA exists, on one project, once.

No navigation standard, user-flow document, or page-hierarchy rule exists for
any other project.

## 10. UI principles already established

**VERIFIED:** token-based colour via `:root`; semantic colour with a paired soft
variant; card-and-border surface composition (Mythos OS `--card`/`--border`,
Command Center `--bg-elevated`/`--border-strong`); explicit radius scales.

**UNKNOWN:** spacing scale, type scale, grid, elevation model, icon system,
button hierarchy, form conventions. None is documented in any project; each
stylesheet solves them ad hoc.

## 11. Responsive principles

**Near-total absence — VERIFIED.**

Recovered evidence amounts to: ID Auto's single breakpoint
`@media (max-width: 520px)`; Uthina's fluid `clamp()` display sizing; SsangYong's
three layout defects found and fixed by headless-browser review.

There is **no responsive standard, no breakpoint set, no mobile-first statement,
and no device matrix** for any project. Given that the portfolio is
Tunisia-facing and mobile-dominant, this is recorded as the **largest single
design gap** in the audit.

## 12. Motion principles

**None — VERIFIED absent.**

No animation system, transition standard, hover-state convention, scroll
behaviour, or micro-interaction guidance exists in any project.

The only motion-related file recovered, `VPS_TRANSFER/SKILL_MOTION (2).md`, is a
generic third-party motion-design skill for a video connector. **It is not Mythos
design work and must not be treated as a recovered motion system.**

## 13. Accessibility principles

**None — VERIFIED absent.** No contrast target, focus standard, ARIA convention,
keyboard-navigation rule, or reduced-motion handling in any project.

Two incidental positives, both **INFERRED** rather than decided: ID Auto uses an
explicit `outline: 2px solid #72d7c5; outline-offset: 1px` focus ring, and all
four stylesheets declare `color-scheme`, which lets the browser render native
controls correctly.

Contrast was **not measured** by this audit and no claim is made about it.

## 14. Performance principles

**None documented.** Observed facts only: NotreJour ships a Vite build pipeline;
no other project has a build step; the SsangYong web root contains a 2.4 MB
uncompressed PNG; the Uthina root contains a 1.75 MB PNG. No budget, no image
policy, no font-loading strategy exists.

## 15. Future project expansion

**PROPOSED — no historical basis.** Nothing in the recovered evidence describes
how a new project should be onboarded. Every project to date appears to have been
designed independently from scratch, which is consistent with the four-palette
outcome.

## 16. Confirmed decisions

Only decisions with direct documentary evidence. Full register in
`docs/MYTHOS_DESIGN_DECISIONS.md`.

- **D-001** Mythos OS dark + gold `#c9a84c` token system — implemented since
  `d1a9d19`, unrevised.
- **D-002** Uthina Chess luxury Roman/chess identity, 9 colours, 3 font stacks —
  documented **and** implemented.
- **D-003** Dar Hijama house-and-cup concept, green/turquoise, with clear-space
  and minimum-size rules — documented, **not implemented**.
- **D-004** Dar Hijama Arabic text vectorised in final SVGs so it renders without
  the font — documented as an applied correction.
- **D-005** SsangYong storefront consumes the catalog API natively — implemented,
  visually verified by headless browser.

## 17. Open decisions

- **O-1** Brand independence vs Mythos consistency (§8). **Blocking** — most
  other design work depends on it.
- **O-2** Is Dar Hijama's charter or its live site authoritative? (C-1)
- **O-3** Should `mythosprod.xyz` have an apex site at all?
- **O-4** Do Mythos Services / Digital / Logistique exist as brands to be
  designed, or are they organisational only?
- **O-5** Where do NotreJour's 7 deferred design files belong? Open since
  2026-08-13.
- **O-6** Should Mouain's 1,787 unmerged lines be merged to `main`?
- **O-7** Is `agribee.tn` intended to be served? Files exist; no vhost does.
- **O-8** Are Uthina's five parallel site copies to be reduced to one?

## 18. Conflicts

Five, detailed as C-1 … C-5 in the recovery document: Dar Hijama charter vs live
site; the missing "piste 2"; two golds; four unarbitrated palettes; `darhijama.tn`
served two ways.

## 19. Missing information

Master brand specification · typography specification (any project except the two
charters) · spacing and grid systems · component library · responsive standard ·
motion system · accessibility standard · performance budget · the rationale for
the Mythos gold · the rejected Dar Hijama pistes · the contents of 14 off-host
repositories · design work on the owner's PC.

## 20. Design readiness

| Question | Answer |
|---|---|
| Can design work start from a recovered baseline? | **Partially.** Two brand kits and one product token set are solid ground. |
| Is there a master brand to extend? | **No.** It would have to be created. |
| Is there a design system to build on? | **No.** Four unrelated stylesheets. |
| Is the portfolio's visual direction knowable? | **Partially.** Dark-and-gold recurs; whether that is *the* Mythos direction is undecided. |
| What blocks Stage 1? | **O-1.** Until brand independence vs consistency is decided, a master brand architecture cannot be specified without pre-empting the owner. |

**Readiness: RECOVERED, NOT READY TO DESIGN.** The evidence is now assembled and
the gaps are named. Stage 1 needs an owner decision on O-1 first.
