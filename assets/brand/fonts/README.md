# Mythos self-hosted fonts

**Status:** specification artifact, resolved under **AUTO-4** (delegated
mandate). Not wired into any application or build — see `fonts.css`'s own
header for the full disclaimer, identical in kind to `../tokens/tokens.css`.

## What is here

Eight WOFF2 files, one per (family, weight, script-subset) triple actually
used by the approved type scale (`docs/design/TYPOGRAPHY.md` §2). Nothing
wider was shipped — no weight, no script subset, no family instance the
scale does not call for.

| File | Family | Weight | Subset | Used by |
|---|---|---|---|---|
| `archivo-expanded-600-latin.woff2` | Archivo, `wdth=125` instance | 600 | latin | Display XL/L, H1, H2 |
| `ibm-plex-sans-400-latin.woff2` | IBM Plex Sans | 400 | latin | Body L/Body/Body S/Caption |
| `ibm-plex-sans-500-latin.woff2` | IBM Plex Sans | 500 | latin | Label |
| `ibm-plex-sans-600-latin.woff2` | IBM Plex Sans | 600 | latin | H3, H4 |
| `ibm-plex-sans-arabic-400-arabic.woff2` | IBM Plex Sans Arabic | 400 | arabic | Body roles, Arabic |
| `ibm-plex-sans-arabic-500-arabic.woff2` | IBM Plex Sans Arabic | 500 | arabic | Label, Arabic |
| `ibm-plex-sans-arabic-600-arabic.woff2` | IBM Plex Sans Arabic | 600 | arabic | H3/H4, Arabic |
| `ibm-plex-mono-400-latin.woff2` | IBM Plex Mono | 400 | latin | Data |

Total: ~248 KB on disk, already WOFF2-compressed.

## Source and licence

Every file is redistributed **unmodified** from Google Fonts' own hosting
(`fonts.googleapis.com/css2`), which serves each family under its original
licence — all four families here are **SIL Open Font License 1.1**
(`TYPOGRAPHY.md` §1). This is the standard way to self-host a Google Fonts
family: download the file the API already points to, host it yourself, keep
the OFL notice obligations (attribution stays with the upstream project;
OFL does not require a bundled licence file for redistribution of the
unmodified binary, but the licence itself is linked here for the record:
<https://openfontlicense.org/open-font-license-official-text/>).

Exact source URLs, captured at fetch time (2026-08-18), one per file:

| File | Source |
|---|---|
| `archivo-expanded-600-latin.woff2` | `fonts.gstatic.com/s/archivo/v25/k3k6o8UDI-1M0wlSV9XAw6lQkqWY8Q8EsJaRE-NWIDdgffTT6jRZ9xdp.woff2` |
| `ibm-plex-sans-400-latin.woff2` | `fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSD6llDB6g4.woff2` |
| `ibm-plex-sans-500-latin.woff2` | `fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSD2FlDB6g4.woff2` |
| `ibm-plex-sans-600-latin.woff2` | `fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSDNF5DB6g4.woff2` |
| `ibm-plex-sans-arabic-400-arabic.woff2` | `fonts.gstatic.com/s/ibmplexsansarabic/v15/Qw3CZRtWPQCuHme67tEYUIx3Kh0PHR9N6Ys43PWrfQ.woff2` |
| `ibm-plex-sans-arabic-500-arabic.woff2` | `fonts.gstatic.com/s/ibmplexsansarabic/v15/Qw3NZRtWPQCuHme67tEYUIx3Kh0PHR9N6YPO_-CRXMR5Kw.woff2` |
| `ibm-plex-sans-arabic-600-arabic.woff2` | `fonts.gstatic.com/s/ibmplexsansarabic/v15/Qw3NZRtWPQCuHme67tEYUIx3Kh0PHR9N6YPi-OCRXMR5Kw.woff2` |
| `ibm-plex-mono-400-latin.woff2` | `fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1i8q1w.woff2` |

## How to reproduce or extend

```
curl -sS "https://fonts.googleapis.com/css2?family=<Family>:wght@<weight>&display=swap" \
  -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
```

A modern desktop Chrome user-agent string is required — without one, the
API serves legacy TTF instead of WOFF2. **Request one weight per call.**
Requesting several weights in a single `family=...:wght@400;500;600` query
returns the *same* variable-font URL for every requested weight (verified
directly, AUTO-4) rather than distinct static instances — a real trap this
session hit and corrected before any file was committed. Then pick out the
`/* latin */` (or `/* arabic */`) block and download the `src: url(...)` it
names.

For the Archivo `wdth` (width) axis, request both axes together in the
order Google's API expects: `family=Archivo:wdth,wght@125,600` — omitting
`wdth` silently serves the normal-width instance, not "Expanded."

## Real metrics measured from these files (AUTO-4, resolves GRID-2 partially)

Using `fontTools` directly against `ibm-plex-sans-400-latin.woff2` (the body
text face the prose-measure rule actually governs):

- The glyph CSS's `ch` unit is defined against — `0` — has advance width
  **0.600 em** in this typeface.
- The frequency-weighted average character advance for real English prose
  (English letter-frequency table, 82% letters / 18% spaces) is
  **0.447 em** — 25% narrower than the `0` glyph.
- A `68ch` box (`GRID_AND_SPACING.md`'s literal CSS value) is therefore
  **652.8 px** at 16 px body size, and fits roughly **91** real average
  characters — not 68, and well past the **65** stated in `TYPOGRAPHY.md`
  §2 as the readability target.
- The already-narrowed token value, `65ch` (`tokens.css`,
  `--mythos-container-prose`), is **624 px** and fits roughly **87** real
  characters — still well past 65.
- To literally hit ~65 real average characters in this typeface at this
  size requires **≈48ch** (≈465 px), not 65ch or 68ch.

**This narrows GRID-2 further but does not close it.** Which number to keep
— the literal 65-character target (a real drop from the current visual
measure) or the existing grid-derived value (defensible as "close enough
for a readability band," since commonly cited comfortable ranges run
45–95 characters) — is a real trade-off against an **owner-approved** value
(`--mythos-container-prose` traces to A-009's grid spec). AUTO-4 records the
evidence; it does not pick the number. See
`docs/MYTHOS_DESIGN_DECISIONS.md` §0.5, AUTO-4, and `GRID_AND_SPACING.md`
§4.3 for the full statement.
