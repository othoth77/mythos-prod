#!/usr/bin/env node
/* IDauto Design System — test suite (zero dependencies)
 * Run: node projects/idauto-design-system/tests/design-system-test.js
 *
 * Verifies: DTCG token integrity, tokens.json ↔ tokens.css sync, the
 * no-arbitrary-values policy, WCAG AA contrast for every semantic pairing,
 * plate validation logic, and structural accessibility invariants of the
 * pages (labels, lang, skip links, dialogs, no fabricated statistics). */

"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error("  FAIL: " + name); }
}

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* ---------- 1. tokens.json — DTCG integrity ---------- */
const tokens = JSON.parse(read("tokens/idauto.tokens.json"));
function walkLeaves(node, cb, trail) {
  for (const k of Object.keys(node)) {
    if (k.startsWith("$")) continue;
    const v = node[k];
    if (v && typeof v === "object" && "$value" in v) cb(trail.concat(k), v);
    else if (v && typeof v === "object") walkLeaves(v, cb, trail.concat(k));
  }
}
let leafCount = 0;
walkLeaves(tokens, () => leafCount++, []);
ok(leafCount >= 60, "tokens.json carries a full token set (" + leafCount + " leaves)");
walkLeaves(tokens, (trail, leaf) => {
  ok(leaf.$value !== undefined && leaf.$value !== "", "token " + trail.join(".") + " has a $value");
}, []);

/* ---------- 2. tokens.css ↔ tokens.json color sync ---------- */
const tokensCss = read("tokens/tokens.css");
for (const theme of ["light", "dark"]) {
  for (const [name, leaf] of Object.entries(tokens.color[theme])) {
    if (name.startsWith("$")) continue;
    const re = new RegExp("--ida-" + name + ":\\s*" + leaf.$value.replace(/[#]/g, "#"), "i");
    ok(re.test(tokensCss), `tokens.css defines --ida-${name} = ${leaf.$value} (${theme})`);
  }
}
const darkBlocks = tokensCss.split(/@media \(prefers-color-scheme: dark\)|\[data-theme="dark"\]/);
ok(darkBlocks.length === 3, "dark palette exists twice: system preference + pinned choice");

/* ---------- 3. no-arbitrary-values policy ---------- */
for (const cssFile of ["css/base.css", "css/components.css"]) {
  const css = read(cssFile);
  const hexes = css.match(/#[0-9A-Fa-f]{3,8}\b/g) || [];
  ok(hexes.length === 0, cssFile + " contains no raw hex colors (found: " + hexes.join(",") + ")");
  const rgbas = (css.match(/rgba?\(/g) || []).length;
  const rgbaFallbacks = (css.match(/var\(--ida-[a-z-]+,\s*rgba?\(/g) || []).length;
  ok(rgbas === rgbaFallbacks, cssFile + " uses rgba only as var() fallback");
}

/* every var(--ida-*) used anywhere is defined in tokens.css */
const defined = new Set([...tokensCss.matchAll(/--ida-[a-z0-9-]+(?=\s*:)/g)].map(m => m[0]));
const sources = ["css/base.css", "css/components.css",
  "pages/index.html", "pages/search.html", "pages/passport.html", "pages/components.html"];
for (const f of sources) {
  const used = new Set([...read(f).matchAll(/var\((--ida-[a-z0-9-]+)/g)].map(m => m[1]));
  const missing = [...used].filter(u => !defined.has(u));
  ok(missing.length === 0, f + " uses only defined tokens (missing: " + missing.join(",") + ")");
}

/* ---------- 4. WCAG contrast ---------- */
function lum(hex) {
  const c = hex.replace("#", "");
  const n = c.length === 3 ? c.split("").map(x => x + x).join("") : c;
  const [r, g, b] = [0, 2, 4].map(i => {
    const v = parseInt(n.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const C = { light: {}, dark: {} };
for (const theme of ["light", "dark"])
  for (const [name, leaf] of Object.entries(tokens.color[theme]))
    if (!name.startsWith("$")) C[theme][name] = leaf.$value;

for (const theme of ["light", "dark"]) {
  const c = C[theme];
  const pairs = [
    // [fg, bg, min, label]
    [c.text, c.bg, 4.5, "text/bg"],
    [c.text, c.surface, 4.5, "text/surface"],
    [c.text, c["surface-sunken"], 4.5, "text/surface-sunken"],
    [c["text-muted"], c.bg, 4.5, "muted/bg"],
    [c["text-muted"], c.surface, 4.5, "muted/surface"],
    [c["text-muted"], c["surface-sunken"], 4.5, "muted/surface-sunken"],
    [c["primary-contrast"], c.primary, 4.5, "primary button text"],
    [c.verify, c["verify-tint"], 4.5, "verified seal/status text"],
    [c.pending, c["pending-tint"], 4.5, "pending seal/status text"],
    [c.danger, c["danger-tint"], 4.5, "anomaly seal/status text"],
    [c.info, c["info-tint"], 4.5, "info seal/status text"],
    [c.verify, c.bg, 4.5, "verify used as text on bg"],
    [c.danger, c.surface, 4.5, "error message on surface"],
    [c["plate-glyph"], c["plate-field"], 4.5, "plate glyphs on plate field"],
    [c.focus, c.bg, 3.0, "focus ring vs page (non-text 3:1)"],
    [c.focus, c.surface, 3.0, "focus ring vs surface (non-text 3:1)"],
    [c["border-strong"], c.bg, 1.6, "strong border visible"],
  ];
  for (const [fg, bg, min, label] of pairs) {
    const r = ratio(fg, bg);
    ok(r >= min, `${theme} ${label}: ${r.toFixed(2)}:1 ≥ ${min}:1`);
  }
}

/* ---------- 5. plate logic ---------- */
const IdaPlate = require(path.join(ROOT, "js/plate.js"));
ok(IdaPlate.getFormat("tn-serie") !== null, "tn-serie format registered");
ok(IdaPlate.validate("tn-serie", { serie: "220", numero: "4518" }).valid, "220/4518 valid");
ok(IdaPlate.validate("tn-serie", { serie: "7", numero: "1" }).valid, "short serie/numero valid");
ok(!IdaPlate.validate("tn-serie", { serie: "2204", numero: "4518" }).valid, "4-digit serie invalid");
ok(!IdaPlate.validate("tn-serie", { serie: "", numero: "4518" }).valid, "empty serie invalid");
ok(!IdaPlate.validate("tn-serie", { serie: "22a", numero: "4518" }).valid, "non-digit serie invalid");
ok(!IdaPlate.validate("tn-serie", { serie: "220", numero: "45189" }).valid, "5-digit numero invalid");
ok(!IdaPlate.validate("tn-serie", {}).complete, "empty parts incomplete");
ok(IdaPlate.validate("nope", {}).errors.format === "unknown_format", "unknown format rejected");
const p1 = IdaPlate.parse("tn-serie", "220 تونس 4518");
ok(p1 && p1.serie === "220" && p1.numero === "4518", "parse Arabic display form");
const p2 = IdaPlate.parse("tn-serie", "220 TU 4518");
ok(p2 && p2.serie === "220" && p2.numero === "4518", "parse canonical ASCII form");
const p3 = IdaPlate.parse("tn-serie", "220-4518");
ok(p3 && p3.serie === "220" && p3.numero === "4518", "parse dashed form");
ok(IdaPlate.parse("tn-serie", "ABC تونس 4518") === null, "reject letters");
const fmt = IdaPlate.getFormat("tn-serie");
ok(fmt.display({ serie: "220", numero: "4518" }) === "220 تونس 4518", "display form is SSS تونس NNNN");
ok(fmt.canonical({ serie: "220", numero: "4518" }) === "220 TU 4518", "canonical machine form");
ok(fmt.word === "تونس", "plate carries تونس — no TN band, no flag");

/* ---------- 6. pages — structural accessibility + honesty ---------- */
const pages = ["pages/index.html", "pages/search.html", "pages/passport.html", "pages/components.html"];
for (const f of pages) {
  const html = read(f);
  ok(/<html lang="fr">/.test(html), f + " declares lang");
  ok(/name="viewport"/.test(html), f + " has viewport meta");
  ok(/ida-skip-link/.test(html), f + " has a skip link");
  ok(/<main id="main"/.test(html), f + " has a main landmark");
  ok(/aria-label="Navigation principale"/.test(html), f + " labels its nav");
  ok(/data-theme-toggle[^>]*aria-label/.test(html), f + " theme toggle labeled");
  // every input id has a matching label[for]
  const inputIds = [...html.matchAll(/<input[^>]*\bid="([^"]+)"/g)].map(m => m[1]);
  for (const id of inputIds) {
    ok(new RegExp('<label[^>]*for="' + id + '"').test(html), f + " input #" + id + " has a label");
  }
  // dialogs are labeled
  const dialogs = [...html.matchAll(/<dialog[^>]*>/g)];
  for (const d of dialogs) ok(/aria-labelledby/.test(d[0]), f + " dialog labeled: " + d[0].slice(0, 40));
  // no fabricated marketing statistics
  ok(!/\d+\s*%\s*(fiable|reliable|disponib)/i.test(html), f + " has no fabricated percentages");
  ok(!/\b\d{3,}[\s]*([Kk]\+?|[Mm]\+?)\s*(véhicules|vehicles|recherches|searches|clients)/.test(html), f + " has no fabricated volume stats");
  // demo data is labeled as specimen
  ok(/SPÉCIMEN/.test(html), f + " labels demo data as SPÉCIMEN");
  // referenced local assets exist
  for (const m of html.matchAll(/(?:href|src)="(\.\.\/[^"]+)"/g)) {
    ok(fs.existsSync(path.join(ROOT, "pages", m[1])), f + " references existing asset " + m[1]);
  }
  ok(!/status\.mythosprod|localhost|127\.0\.0\.1/.test(html), f + " references no internal host");
}

/* ---------- 7. motion + touch discipline ---------- */
const base = read("css/base.css");
ok(/prefers-reduced-motion/.test(base), "reduced-motion kill switch present");
const comp = read("css/components.css");
ok(/\.ida-btn\s*{[^}]*min-height:\s*44px/s.test(comp), "buttons meet 44px touch floor");
ok(/\.ida-input\s*{[^}]*min-height:\s*44px/s.test(comp), "inputs meet 44px touch floor");
ok(!/glow|neon/i.test(comp), "no glow/neon effects");
ok((comp.match(/@keyframes/g) || []).length <= 2, "motion stays minimal (≤2 keyframes)");

/* ---------- report ---------- */
console.log(`idauto-design-system: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
