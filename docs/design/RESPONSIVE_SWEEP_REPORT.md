# Responsive + Zoom + Console-Error Sweep — Mythos Prod

**Date:** 2026-08-19
**Status:** AUDIT ONLY — changes nothing
**Produced by:** a specialist QA agent under a delegated mandate, for chief review
**Target:** the PHP/vanilla-JS app at the repo root (`index.html`, `js/`, `css/`, `api.php`), driven **locally and in isolation** via `tools/visual-verify.js`'s pattern — a fresh OS temp copy served by `php -S 127.0.0.1:<port>`, session seeded by writing `mp_auth_session` to `localStorage` exactly as `js/auth.js`'s `AUTH.createSession()` does. Nothing in this run touched a real host, real `appdata/`, or this checkout's own server.

Driver script: `tools/visual-verify.js`-derived, run from scratch as `sweep.js` (not committed). Screenshots: `/tmp/sweep-shots/` (32 PNGs, one per width × view — paths listed at the end of §1).

---

## 1. Summary table — horizontal overflow (`document.documentElement.scrollWidth > window.innerWidth`)

| Width (px) | dashboard | comptabilite | compta-suppliers | fournisseurs |
|---:|:---:|:---:|:---:|:---:|
| 320  | No | No | No | No |
| 375  | No | No | No | No |
| 640* | No | No | No | No |
| 768  | No | No | No | No |
| 1024 | No | No | No | No |
| 1280 | No | No | No | No |
| 1440 | No | No | No | No |
| 1920 | No | No | No | No |

\* 640 = the WCAG 200%-zoom-of-1280 equivalence width (see §3). 320 doubles as the 400%-zoom equivalence width.

**32/32 width × view combinations: no horizontal overflow.** Every measurement produced `scrollWidth − innerWidth = −15px`, not a positive delta — this reflects Chromium's headless `window.innerWidth` reserving scrollbar gutter space that `scrollWidth` does not include; it is a fixed, negative, width-independent offset, not a layout defect.

All four views (`dashboard`, `comptabilite`, `compta-suppliers`, `fournisseurs`, all reached via `window.showView(...)`) rendered (`.view.active` present) at every width. No view failed to render at any tested width — no honest null needed here.

Screenshots (32 total, pattern `w<width>-<view>.png`): `/tmp/sweep-shots/w320-dashboard.png` … `/tmp/sweep-shots/w1920-fournisseurs.png`. Full list available via `ls /tmp/sweep-shots/`.

---

## 2. Console errors

**0 non-network console errors and 0 uncaught page errors** across all 32 width × view combinations, and 0 across the dedicated reduced-motion pass (§4).

`net::ERR_*` failures (the external Google Fonts CDN, unreachable in this sandbox — pre-existing, out of scope per the task's own baseline) were excluded from the error count by the driver script before comparison, matching `tools/visual-verify.js`'s own `EXPECTED` filter convention. No other request or console-error class was observed at any width or view.

**Finding: none.** This is a clean result, not an absence of testing — `page.on('console')` and `page.on('pageerror')` listeners were attached for the full session on every context, not sampled.

---

## 3. Zoom equivalence (WCAG 1.4.10 Reflow)

Per WCAG 2.x guidance, 200% zoom of a 1280px viewport and 400% zoom of a 1280px viewport are commonly approximated by testing at the equivalent effective CSS pixel widths: **1280 / 2 = 640px** (200%) and **1280 / 4 = 320px** (400%). Both were tested as explicit entries in the width sweep (§1), not as a separate pass:

- **640px (≈200% zoom):** no overflow, all 4 views render, 0 console errors.
- **320px (≈400% zoom):** no overflow, all 4 views render, 0 console errors.

**Finding: the app reflows cleanly at both zoom-equivalent widths for the 4 views tested.** This does not test true browser zoom (which also enlarges fonts/touch targets, unlike a viewport-width proxy) — it tests the reflow dimension of 1.4.10 only, which is what a fixed effective width can verify.

---

## 4. Touch targets (width 375, `.nav-btn` sidebar + dashboard `.btn`)

Mythos's own design system standard (`docs/design/RESPONSIVE_ACCESSIBILITY_MOTION.md`, "A-022 requires 44 × 44") sets a 44×44 CSS px minimum interactive target — the WCAG AAA level (2.5.5), not merely AA (2.5.8's 24×24).

All 11 visible `.nav-btn` sidebar items were measured at 375px width:

| Selector | W × H (px) | Meets 44×44? |
|---|---|---|
| `.nav-btn#nav-dashboard` | 283 × 38 | No (height −6px, 14% short) |
| `.nav-btn#nav-tache` | 283 × 39 | No (height −5px, 11% short) |
| `.nav-btn#nav-inscriptions` | 283 × 39 | No |
| `.nav-btn#nav-appel` | 283 × 39 | No |
| `.nav-btn#nav-conformite` | 283 × 39 | No |
| `.nav-btn#nav-participations` | 283 × 39 | No |
| `.nav-btn#nav-paiements` | 283 × 39 | No |
| `.nav-btn#nav-joueurs` | 283 × 39 | No |
| `.nav-btn#nav-certifications` | 283 × 39 | No |
| `.nav-btn#nav-documentation` | 283 × 39 | No |
| `.nav-btn#nav-parametres` | 283 × 39 | No |

**Finding: 11/11 sampled sidebar nav buttons fail the 44×44 target-size standard on the height axis** — width is generous (283px, full sidebar column) but height sits at 38–39px, 5–6px (11–14%) short of 44px. This is a sample, not exhaustive (only the visible sidebar list at 375px was measured); the shortfall is uniform across every button, consistent with a single shared padding/line-height rule rather than per-button variance.

`.btn` elements scoped to `#view-dashboard`: **0 found (honest null).** The dashboard view's only interactive controls (countdown widgets, the "Inscriptions reçues" card) use inline styles, not the `.btn` class, so this check — as scoped to `.btn` specifically — has nothing to sample there. This is not evidence the dashboard has no small targets; it is evidence the `.btn` class isn't present on it. The "Inscriptions reçues" card button was not separately measured (out of the `.btn`-class scope this pass targeted) and should be checked in a follow-up if the chief wants full dashboard coverage.

---

## 5. Reduced motion (`page.emulateMedia({reducedMotion: 'reduce'})`, dashboard, 1280×900)

Emulation confirmed active: `window.matchMedia('(prefers-reduced-motion: reduce)').matches === true`.

Computed styles under emulation:

| Selector | `transitionDuration` | `animationName` |
|---|---|---|
| `.nav-btn` | `0.15s, 0.15s, 0.22s, 0.22s` (4 tracked properties) | `none` |
| `#sidebar` | `0s` | `none` |

**Finding: `.nav-btn` transitions (background/color at 0.15s, two further properties at 0.22s — the sidebar drawer/hover transform) still run at full duration under `prefers-reduced-motion: reduce`.** A repo-wide search (`grep -rl prefers-reduced-motion css/ index.html js/`) found **zero** matches anywhere in the codebase — no `@media (prefers-reduced-motion: reduce)` rule exists at all. `#sidebar`'s own transition is already `0s` in the default state (unrelated to the media query — it is simply not animated by that rule at this breakpoint), so it happens to comply by coincidence, not by design.

As framed by the task: **this app predates the design system**, and `docs/design/RESPONSIVE_ACCESSIBILITY_MOTION.md` (§ "every transform collapses to opacity" under reduced motion) documents the target state this legacy surface has not yet been migrated to. Recorded here as a **finding for planning, not a regression** — there is no prior reduced-motion behavior to have regressed from.

---

## 6. Overall read

- Layout/reflow (widths 320–1920, plus the two zoom-equivalent widths, 4 views each): **clean, 32/32.**
- Console/runtime errors: **clean, 0 across every pass.**
- Touch target size: **11/11 sampled sidebar nav buttons under the 44×44 AAA standard**, by a small, uniform margin (5–6px).
- Reduced motion: **not implemented anywhere in the codebase** — expected given the app predates the design system, but worth scheduling.

No overflow, no console defects, no broken routes were found at any tested width. The two open items (nav-btn height, missing reduced-motion support) are both small, uniform, single-rule fixes rather than scattered defects.
