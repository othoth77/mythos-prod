# sites/mythosprod.xyz — the MYTHOS ecosystem hub

**Status: BUILT (AUTO-13, 2026-08-19), NOT DEPLOYED** — no apex vhost
exists (O-003's recorded state); see `DEPLOYMENT.md` for the exact
operator runbook.

**Authority.** The final-mission mandate (2026-08-19) explicitly instructs
building the hub's information architecture — superseding O-003's open
"should it exist at all" for the *build* (deployment remains a separate,
blocked step). Structure: `docs/design/PUBLIC_ECOSYSTEM_ARCHITECTURE.md`
§9's A-020 tree, exactly. Register entry: `MYTHOS_DESIGN_DECISIONS.md`
§0.5, AUTO-13.

**What it is.** A single, fully static, self-contained page:

- **Canonical design system**: composes only from `assets/tokens.css`
  (build-time copy of `assets/brand/tokens/tokens.css`) and the
  self-hosted approved faces (`assets/fonts.css` + WOFF2, copies of the
  AUTO-4 set). No external request of any kind — no CDN, no analytics,
  no scripts.
- **The A-020 tree**: five units under MYTHOS; Mythos Command Center
  under Mythos OS, never beside the units. Units with no recorded
  operations (Services, Digital, Logistique) are listed as structure
  only — **no invented business claims** (O-A2 discipline).
- **Projects in their own identities** (A-004/A-006): neutral tiles,
  name + domain + evidence-based status; the five live projects link
  out, the three built-unserved ones are "En préparation" without
  links. No Mythos-skinning of any project.
- **One 35° gesture** (A-012): the hero's diagonal hairline, nowhere
  else.
- **SEO**: title/description/canonical/OG/JSON-LD Organization +
  `sitemap.xml` + `robots.txt`. No fabricated social profiles or
  addresses.
- **Accessibility**: skip link, landmarks, semantic headings,
  `:focus-visible` ring, 44px interactive targets, reduced-motion via
  the token sheet, `lang="fr"`.

**Languages.** French (`lang="fr"`) v1. Arabic/English are foundations
(the Arabic face ships in `assets/fonts/`; tokens carry the motion/RTL
rules) — deliberately not shipped half-translated.

**Asset provenance.** `assets/tokens.css`, `assets/fonts.css`,
`assets/fonts/*` and the brand images are build-time copies of
`assets/brand/*` (AUTO-1 masters, AUTO-3 tokens, AUTO-4 fonts). If the
canonical sources change, re-copy — this directory is what production
serves, so it must be self-contained.
