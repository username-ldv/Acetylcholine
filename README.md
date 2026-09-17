# Acetylcholine

A pop-up dictionary browser extension for language learners (Chromium + Firefox, Manifest V3),
in the spirit of [Yomitan](https://yomitan.wiki/): hold a key, hover a word, read its definitions
from every dictionary you have installed, and send it to Anki.

- **Roadmap and architecture:** [`docs/PLAN.md`](docs/PLAN.md)
- **Dictionary format:** [`docs/ACE_FORMAT.md`](docs/ACE_FORMAT.md)

## Layout

```
apps/extension   WXT + Svelte 5 + Tailwind 4 + shadcn-svelte extension
apps/cli         `ace` command line tool (convert / inspect / lookup)
packages/ace     .ace format: types, validation, streaming reader + writer
packages/convert Yomitan → .ace (MDX → .ace planned)
packages/shared  settings schema, messaging, language adapters (extension runtime)
docs/            plan and specifications
```

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2 (package manager and CLI runtime)
- Node ≥ 22 (used by the WXT/Vite toolchain)
- Chrome and/or Firefox ≥ 128 for running the extension

## Getting started

```sh
bun install

# quality gates
bun run typecheck
bun test            # vitest
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
```

Useful flags: `--title`, `--id`, `--reading-tags pinyin,zhuyin` (one per input, auto-detected
otherwise), `--index-readings` (make readings searchable), `--no-merge` (keep every source row as
its own entry), `--level 0-9`.

## Status

Phase 0 (scaffold) and Phase 1 (`.ace` format + Yomitan converter) are in place; the extension
currently only contains the build skeleton. See the plan for what comes next.

## License

MIT. No Yomitan source code is used; the dictionary format is compatible by design only.
