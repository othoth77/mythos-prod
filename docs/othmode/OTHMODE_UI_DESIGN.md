# OTHMODE — UI/UX Design + Design System (Charte Graphique)

Phase 1 design. Nothing implemented. Visual preview (static, non-functional): [preview/index.html](preview/index.html).
Master document: [OTHMODE_AUDIT_AND_DESIGN.md](OTHMODE_AUDIT_AND_DESIGN.md)

**بالعربية باختصار:** واجهة واحدة بسيطة: شريط جانبي فيه أقسام المنصّة، ولوحة رئيسية تعرض الحالة العامة. نحافظ على تصميم "مركز الأوامر" الحالي (ألوانه وهويته نظيفة وجاهزة) ونوسّعه بدل أن نصمّم من الصفر. الواجهة ستدعم العربية بالكامل (الاتجاه من اليمين إلى اليسار موجود في البنية أصلاً).

---

## 1. Design position

The existing MCC-1 web UI is professionally built (token-driven CSS, light/dark, sidebar + header shell, card/table components, keyboard shortcuts, i18n with RTL support wired). **The OTHMODE UI is an extension of it, not a replacement.** The mandated 21 sections consolidate into **12 screens** — evolution sub-concepts are tabs of one screen, not separate screens (mandate: "do not create unnecessary screens").

## 2. Information architecture

```text
Sidebar (grouped)
  OVERVIEW      Dashboard
  LIBRARY       Commands · Saved Commands (favorites/templates/notes) · Workflows (documentation)
  CAPABILITIES  Skills · Tools · Providers
  OPERATIONS    Projects · Health · Status (read-only) · Command History
  INTELLIGENCE  Memory · Evolution
  SYSTEM        Search (also global ⌘K//) · Settings (incl. OthMode switch)
```

### Screens

1. **Dashboard** — OthMode state banner (ON/OFF), health summary strip, recent history, quick actions, most-used commands, open evolution reviews, active project + next action. Everything links into its module.
2. **Commands** — existing MCC library UI, rebranded (search, categories, detail with variables/copy/versions).
3. **Saved Commands** — existing favorites/templates/notes views consolidated under one nav item.
4. **Skills** — unified list over both registries (`.claude/skills` + executor skills): name, source registry, version, status, description, last change; detail view renders SKILL.md. Read-only; "propose change" links to the Evolution flow.
5. **Tools** — registry table (id, policy class, risk, provider, capabilities), health chip per tool, schema detail.
6. **Providers** — cards: provider, role (EXECUTION AUTHORITY / ADVISORY), enabled, credential presence (never values), last health, routing/fallback summary. Claude card marked PRIMARY.
7. **Projects** — registry over `projects/meta`: repository, state, current task, next action, status, linked skills/tools/providers/dependencies.
8. **Health** — matrix of components (tools, providers, integrations, projects, evolution components) × state (ACTIVE / DEGRADED / FAILED / BLOCKED / DEPRECATED / REPLACEMENT_REQUIRED); recovery tracker showing DETECT→NOTIFY→SEARCH→COMPARE→SELECT→REPLACE→TEST→UPDATE STATUS progress per incident.
9. **Status** — read-only embed of Status Center current state + link out; clearly labeled "execution truth lives in Status Center".
10. **Command History** — unified timeline (command, timestamp, duration, status, result, evidence link, next action), filterable by source (library/executor/orchestrator), project, status.
11. **Memory** — search over oth-knowledge (read-first); result cards show provenance/trust class; banner when the store is absent (fail-closed = normal state). Ingestion explicitly "operator CLI only".
12. **Evolution** — one screen, tabs: **Events** (timeline with stage chips TRIGGER…RESULT) · **Genes** · **Capsules** · **Signals** (with dispositions) · **Review queue** (risk tiers, approval state) · **Validation** (PASS/FAIL records) · **Rollback** (applied evolutions + rollback points, git SHAs).
13. **Settings** — OTHMODE availability panel (always READY; explains the per-command `othmode` keyword — no switch, no toggle; changed 2026-08-26), language (EN/FR/AR), theme, open-source registry table.

Global **Search** overlays everything (existing `/` shortcut; extended to search commands, skills, tools, providers, projects, memory, history).

## 3. Mandated states (all screens)

| State | Treatment |
|---|---|
| Empty | Icon + one sentence + primary action ("No signals recorded yet. Signals appear when detectors run."). Never blank. |
| Loading | Skeleton rows/cards; no spinners over 300ms without text. |
| Error | Inline card: what failed, which layer (API/store/upstream), retry button, never raw stack. |
| Success | Toast (existing pattern), auto-dismiss; destructive/major actions get persistent confirmation rows. |
| Permission | Read-only badge + lock chip on write actions (existing MCC "Read-only" header pattern extended per-module). |
| Provider failure | Provider card → FAILED/DEGRADED chip + last-error line + link to Health recovery flow; dependent screens show a thin warning banner, remain usable. |
| Tool failure | Same chip pattern on the tool row + history entries flagged. |
| Evolution failure | Event keeps its honest terminal stage (e.g. FAILED_VALIDATION) in red-soft chip; never hidden or deleted. |
| Responsive | ≤900px: sidebar collapses to a drawer (existing breakpoint pattern); tables become stacked cards; dashboard strips wrap. Mobile is read-mostly; writes allowed but never required. |

## 4. Design System — Charte Graphique OTHMODE

### 4.1 Existing identity audit

- **MCC token set** (`reference/web/app.css`): neutral grays + indigo accent (`#4f46e5` light / `#7c73ff` dark), semantic ok/warn/danger with soft variants, radius 10/6, two elevation shadows, system font stacks, 60px header / 232px sidebar. **Verdict: KEEP — promote to the OTHMODE system.**
- **Mythos design system** (`docs/design/MYTHOS_DESIGN_SYSTEM.md`, `--mythos-*` tokens): the ecosystem-wide brand for Mythos OS surfaces. **Verdict: coexist** — OTHMODE is a distinct product in the ecosystem; it keeps its own accent identity but follows the same structural conventions (token naming discipline, forced-colors and a11y decisions).
- MOS Console + Status Center have their own restrained identities. Not merged; linked surfaces stay as they are.

### 4.2 Target tokens (`--oth-*`, values from the proven MCC set)

| Token | Light | Dark |
|---|---|---|
| `--oth-bg` / `-elevated` / `-sunken` / `-code` | #f6f7f9 / #ffffff / #eceef2 / #f4f5f7 | #0e1116 / #161b22 / #0a0d12 / #0d1117 |
| `--oth-border` / `-strong` | #dfe3e8 / #c6ccd4 | #262c36 / #39414d |
| `--oth-text` / `-muted` / `-faint` | #14181f / #5b6472 / #8a929e | #e6edf3 / #9aa5b1 / #6e7781 |
| `--oth-accent` / `-hover` / `-soft` | #4f46e5 / #4338ca / #eef0fe | #7c73ff / #9189ff / #1e1b3a |
| `--oth-ok` / `-soft` | #087443 / #e3f5eb | (existing dark equivalents) |
| `--oth-warn` / `-soft` | #96590a / #fdf1dc | ″ |
| `--oth-danger` / `-soft` | #b3261e / #fdeceb | ″ |
| Radius / shadows / layout | 10px & 6px · shadow / shadow-lg · header 60px · sidebar 232px | same |

New semantic additions (health/evolution): `--oth-state-active`(=ok) · `--oth-state-degraded`(=warn) · `--oth-state-failed`(=danger) · `--oth-state-blocked` (#6b21a8 purple family + soft) · `--oth-state-deprecated` (neutral gray chip) · `--oth-state-replace` (warn-strong).

### 4.3 Rules

- **Logo/brand:** wordmark "OTHMODE" in the UI font, bold, letter-spaced, accent-colored "OTH" — final mark is an owner decision; placeholder specified for implementation. Subtitle: "Mythos control platform".
- **Typography:** system UI stack (existing `--font-ui`); mono stack for commands/SHAs/evidence. Arabic: rely on system Arabic fallbacks (Segoe UI on Windows); minimum 14px body in AR.
- **Spacing:** 4px base scale (4/8/12/16/24/32) — matches current CSS practice.
- **Icons:** current UI is text/emoji-light; adopt a single inline-SVG set (one style, 16/20px grid) at implementation; no icon font, no CDN.
- **Buttons/forms/cards/tables:** keep MCC components; tables get the stacked-card responsive variant; every status is a chip = colored soft background + strong text (never color alone — a11y).
- **Status indicators:** dot + label chip, the six health states above; evolution stages use neutral chips with one accent for the current stage.
- **Navigation:** grouped sidebar (§2); active item = accent soft background + accent left bar.
- **Command interface:** global `/` search stays; `⌘K` palette optional later.
- **Notifications:** existing toast pattern; a persistent bell only if/when recovery workflow lands.
- **Dark/light:** both, user toggle + `prefers-color-scheme` default (existing behavior).
- **RTL/Arabic:** `dir` flips per locale (mechanism exists in i18n.js); sidebar mirrors; chips/tables mirror; numerals stay Western in technical contexts (SHAs, counts); Arabic strings must be human-reviewed before shipping (explicitly deferred by MCC for exactly this reason).
- **One product rule:** every new screen composed only of tokens + existing components; any new component enters this document first.

## 5. Bilingual UI

EN and FR complete today; AR ships in OTHMODE Phase 1 (translation review is the only blocker — mechanism ready: fallback chain, `name_ar` columns through DB and API). Status Center already carries a simple-Arabic explanation layer — reuse its tone for OTHMODE Arabic strings.
