# Acetylcholine

A pop-up dictionary browser extension for language learners (Chromium + Firefox, Manifest V3),
in the spirit of [Yomitan](https://yomitan.wiki/): hold a key, hover a word, read its definitions
from every dictionary you have installed, and send it to Anki.

- **Roadmap and architecture:** [`docs/PLAN.md`](docs/PLAN.md)
- **Dictionary format:** [`docs/ACE_FORMAT.md`](docs/ACE_FORMAT.md)

## Layout

```
apps/extension   WXT + Svelte 5 + Tailwind 4 + shadcn-svelte extension
apps/cli         `ace` command line tool (convert / inspect / lookup / check)
packages/ace     .ace format: types, validation, streaming reader + writer
packages/convert Yomitan → .ace (MDX → .ace planned)
packages/shared  settings schema, messaging, language adapters, lookup grouping, content renderers
docs/            plan and specifications
```

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2 (package manager and CLI runtime)
- Node ≥ 22 (used by the WXT/Vite toolchain; Node 24 runs the e2e script directly)
- Chrome and/or Firefox ≥ 128 for running the extension

## Getting started

```sh
bun install

# quality gates
bun run typecheck
bun run test        # vitest (packages + extension database layer)
bun run lint        # biome

# extension
bun run ext:dev             # Chrome, with HMR
bun run ext:dev:firefox
bun run ext:build           # → apps/extension/.output/chrome-mv3
bun run ext:build:firefox   # → apps/extension/.output/firefox-mv3
```

Load the unpacked build from `apps/extension/.output/<browser>` (Chrome: `chrome://extensions`
→ Developer mode → Load unpacked; Firefox: `about:debugging` → Load Temporary Add-on).

## Converting dictionaries

```sh
# one Yomitan zip
bun run ace convert path/to/dict.zip -o dict.ace

# pinyin + zhuyin editions of the same dictionary → one .ace with both readings per entry
bun run ace convert dict-pinyin.zip dict-zhuyin.zip -o dict.ace

bun run ace inspect dict.ace --validate
bun run ace lookup dict.ace 读 讀
bun run ace check dict-pinyin.zip dict-zhuyin.zip   # conventions check for edition pairs
```

Useful flags: `--title`, `--id`, `--reading-tags pinyin,zhuyin` (one per input, auto-detected
otherwise), `--index-readings` (make readings searchable), `--no-merge` (keep every source row as
its own entry), `--level 0-9`.

## Using the extension

1. Open the extension's settings (toolbar button → *Settings*, or it opens on first install).
2. **Dictionaries:** drop `.ace` files onto the page (or *Choose files…*). Imports run in a Web
   Worker with per-stage progress; the list shows counts, size, storage usage, enable switches,
   ordering and details. Re-importing a file with the same id replaces the old copy.
3. **Scanning:** trigger (hover / click), key to hold (Shift by default), scan length, delay,
   excluded sites and ignored elements.
4. **Appearance:** popup theme and size, font scale, reading-system preference (e.g. zhuyin before
   pinyin), custom CSS.
5. **Search:** look text up directly; results render exactly as in the popup.

On any page: hold Shift and hover a word. The popup groups results by word + pronunciation, shows
headword variants (读 / 讀), the primary and secondary readings, and each dictionary's content in
its own shadow root with the dictionary's stylesheet. Internal links and hovering inside the popup
open nested lookups (← / Backspace goes back, Esc closes).

## End-to-end check

```sh
bun run ext:build
node apps/extension/e2e/run.ts            # all .ace files in example-dictionaries/ace
node apps/extension/e2e/run.ts a.ace b.ace
```

Requires Playwright's Chromium (`bunx playwright install chromium`; branded Chrome no longer
accepts `--load-extension`). The script imports the dictionaries through the options page,
reloads, times lookups, runs a search and Shift-hovers a test page; screenshots and
`report.json` are written to `apps/extension/e2e/out/`.

## Status

Phases 0–3 of the plan are in place: scaffold, `.ace` format + Yomitan converter, extension
database + import UI, and the lookup engine + popup. Next: MDX converter (Phase 4), profiles and
deeper settings (5), Anki (6). See the plan for details.

## License

MIT. No Yomitan source code is used; the dictionary format is compatible by design only.
