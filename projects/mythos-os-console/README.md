# MYTHOS OS Command Center

The read-only operations console for Mythos OS — `os.mythosprod.xyz`.

- **Architecture:** `docs/MYTHOS_OS_CONSOLE_ARCHITECTURE.md`
- **Design system:** `docs/MYTHOS_OS_DESIGN_SYSTEM.md`
- **Tests:** `tests/mos-1-console-test.js`

Not to be confused with `projects/command-center/`, which is the command
*library* at `ordre.mythosprod.xyz` — a different product.

## Run it

```bash
MOS_EXECUTOR_TOKEN=… node projects/mythos-os-console/reference/server.js
```

No dependencies, no build step, no `package.json`. It starts without a
token and reports that it has none rather than refusing to boot — see the
architecture doc §5.2.

```bash
node tests/mos-1-console-test.js
```

## Layout

```
reference/
  server.js            GET/HEAD only; static whitelist + read-only /api
  upstream.js          the only code that talks to anything
  web/
    index.html         the shell, and only the shell
    mythos.css         the MYTHOS design system — reusable by every module
    console.css        composition for this surface; contains no colour literal
    modules.js         the module registry — the scalability contract
    app.js             router + one render function per module
tools/
  contrast.js          WCAG 2.1 measurement over every rendered pair
  visual-verify.js     headless-browser gate (D-010); needs a browser
  host-preflight.sh    read-only deployment precondition check, run on the VPS
deploy/
  nginx-os.mythosprod.xyz.conf
  mythos-os-console.user.service
```

## Verify it

```bash
node tests/mos-1-console-test.js                              # 322 assertions
node projects/mythos-os-console/tools/contrast.js             # WCAG 2.1, 26/26 AA
node projects/mythos-os-console/tools/visual-verify.js        # 499 browser checks
bash projects/mythos-os-console/tools/host-preflight.sh       # on the VPS only
```

`contrast.js` is also asserted by the test suite, so AA cannot regress
silently. `visual-verify.js` needs playwright and exits 2 with a plain
message when it is absent — a browser is deliberately not a dependency of
this repository.

## Deploy it

`docs/MYTHOS_OS_CONSOLE_ARCHITECTURE.md` §10.2 is the runbook, with
rollback. Run `tools/host-preflight.sh` first; it refuses to pass if any
precondition is missing.

## Adding a module

Two edits, and nothing else:

1. An entry in `MODULES` in `reference/web/modules.js` — `id`, `label`,
   `icon`, `section`, `state`, `source`, `summary`.
2. A render function in `reference/web/app.js`, keyed by the same `id`.

The sidebar, routing, page chrome and empty states follow automatically.
Do not edit `mythos.css` to add a module; if a surface needs a colour the
token set lacks, add the **token** — the test suite fails on a colour
literal in `console.css`, and that is what keeps a fifth palette from
accumulating.

A module registered with `state: 'planned'` renders an honest not-built
surface naming its future data source. That is deliberate: an unbuilt
module is shown and marked, never hidden.
