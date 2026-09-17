# Acetylcholine — Project Plan

Acetylcholine is a pop-up dictionary browser extension (Chromium + Firefox, Manifest V3) in the
spirit of Yomitan, built from scratch under the MIT license. It looks up the word under the cursor
in many dictionaries at once, renders rich per-dictionary content, and exports cards to Anki.

This document is the living roadmap. Each phase ends in a checkpoint that is demonstrable on its
own. Status markers: `[ ]` todo, `[~]` in progress, `[x]` done.

---

## 1. Goals and non-goals

**Goals**

- Very fast hover lookups (Shift + hover by default; key configurable; also click / no-modifier modes).
- One unified dictionary container, `.ace`, produced by a standalone converter from
  Yomitan/Yomichan zips and MDX/MDD dictionaries. Web-request ("online") dictionaries are configured
  in the extension directly.
- 10+ imported dictionaries searched in parallel; results grouped by headword + reading, with
  headword variants (讀 / 读) and dictionary attribution, like the reference screenshot.
- Rich rendering: Yomitan structured content **and** arbitrary sanitized HTML + CSS from MDX, each
  dictionary's CSS isolated from the others and from the page.
- Full settings UI (Svelte 5 + shadcn-svelte): profiles, dictionaries, scanning, appearance,
  custom CSS, Anki, backup/restore.
- Anki integration through AnkiConnect: add cards, detect duplicates, open existing notes.
- Multi-language by design (language adapters), Chinese first, Japanese deinflection later.

**Non-goals (for now)**

- OCR / screenshot lookup, audio pronunciation servers, mobile browsers, cloud sync.
- Running dictionary JavaScript (MDX `.js` files). Scripts are stripped; CSS is kept.

## 2. Architecture overview

```
acetylcholine/                      bun workspaces monorepo
├─ apps/
│  ├─ extension/                    WXT + Svelte 5 + Tailwind 4 + shadcn-svelte (Chrome MV3 / Firefox MV3)
│  └─ cli/                          `ace` CLI: convert / inspect / lookup
├─ packages/
│  ├─ ace/                          .ace format: types, zod schema, streaming reader + writer (browser + Node/Bun)
│  ├─ convert/                      converters → .ace   (yomitan, mdx)  — environment-agnostic core
│  └─ shared/                       settings schema, messaging protocol, language adapters, content renderer
├─ docs/                            PLAN.md (this), ACE_FORMAT.md
└─ example-dictionaries/            local test data (git-ignored)
```

**Runtime pieces inside the extension**

| Piece | Context | Responsibility |
| --- | --- | --- |
| `background` | service worker (Chrome) / event page (Firefox) | opens IndexedDB, runs lookups, talks to AnkiConnect, serves assets, holds settings cache |
| `content` script | every page | scanning (modifier + hover), text extraction under cursor, highlight, hosts the popup iframe |
| `lookup` page | iframe injected by the content script (extension origin) | Svelte popup UI: renders results, nested lookups, Anki buttons |
| `options` page | extension tab | Svelte settings app, dictionary import (runs in a Web Worker), backup/restore |
| `search` page | extension tab | free-text search UI (later) |

**Why an iframe for the popup:** page CSS cannot leak in, dictionary CSS cannot leak out, and page
CSP cannot block extension resources. Inside the iframe, each dictionary's block gets its own
shadow root with that dictionary's `styles.css`, so MDX stylesheets like `entry { display:block }`
work untouched.

**Storage**

- `browser.storage.local` → versioned settings JSON (zod schema + migrations).
- IndexedDB `acetylcholine` (shared by all extension contexts): `dictionaries`, `entries`,
  `keys` (index on `key`), `meta`, `tags`, `kanji`, `assets` (Blobs). Import runs from the options
  page in a Web Worker, streaming the `.ace` zip chunk by chunk. Lookups run in the background.

**Lookup algorithm (per profile)**

1. Content script finds the caret position under the cursor, extracts up to `scanLength` characters
   forward across inline nodes (plus sentence context for Anki).
2. Background normalizes text (NFC, language adapter hooks), builds candidate strings (all prefixes,
   plus deinflections for languages that need them), and issues one IndexedDB transaction with a
   `getAll` per candidate on the `key` index, filtered to the profile's enabled dictionaries.
3. Entries are fetched, grouped by (headword-set, reading), ordered by match length → dictionary
   order → score, and returned with the matched length so the content script can highlight it.
4. An in-memory LRU caches recent lookups; per-dictionary Bloom filters (built at import) reject
   misses without touching IndexedDB (perf phase).

## 3. The `.ace` format (summary)

See `docs/ACE_FORMAT.md` for the full spec. In short: a ZIP container with `manifest.json`,
newline-delimited JSON chunks for entries / keys / meta / kanji, `tags.json`, `styles.css`, and
`assets/`. An **entry** is one (headwords[], readings[] with tags, content) record; **keys** are
the lookup strings pointing at an entry (`headword`, `variant`, `reading`, `alias`). This is what
gives "many keys → one definition", "one sense → several tagged readings (pinyin + zhuyin)", and
"one word → several senses with different pronunciations".

## 4. Phases and checkpoints

### Phase 0 — Scaffolding  `[x]`
- [x] bun-workspaces monorepo, TypeScript 5.9, Biome, Vitest.
- [x] Packages `ace`, `convert`, `shared`; apps `cli`, `extension`.
- [x] WXT extension builds for Chrome and Firefox (both MV3); options page renders shadcn-svelte
      components; background + content script stubs; `bun run ext:dev` works.

**Checkpoint:** `bun install && bun run typecheck && bun test && bun run ext:build` all green.

### Phase 1 — `.ace` format + Yomitan converter  `[x]`
- [x] `@acetylcholine/ace`: types, zod schema, streaming `AceWriter` and `AceReader` (zip.js).
- [x] `@acetylcholine/convert`: Yomitan zip → `.ace` covering `index.json`, `term_bank`,
      `term_meta_bank`, `tag_bank`, `kanji_bank`, `kanji_meta_bank`, `styles.css`, assets.
      Generic merging: sequenced dictionaries merge rows by sequence + identical content
      (headwords and tagged readings unioned, across trad/simp rows and across pinyin/zhuyin
      editions); unsequenced ones by headword set + content. No dictionary-specific logic;
      content-marker variant extraction is opt-in only. CSS rules targeting `data-sc-reading-tag`
      are stripped (the renderer picks the reading system).
- [x] `ace convert <in...> -o <out.ace>`, `ace inspect [--validate]`, `ace lookup`.
- [x] Unit tests with in-memory fixture dictionaries; all 10 sample zips converted (5 merged files).

**Checkpoint (met):** every sample Yomitan dictionary converts; `ace lookup guifan.ace 读` prints
two entries (dòu / dú), each with 读 | 讀 headwords and pinyin + zhuyin readings.

| merged dictionary | source rows (per edition) | source entries (sequences) | `.ace` entries | keys | size | time |
| --- | --- | --- | --- | --- | --- | --- |
| 现代汉语规范词典 | 78,037 | 74,668 | 74,668 | 78,037 | 9.2 MiB | 5.1 s |
| 现代汉语词典 | 75,486 | 70,109 | 70,109 | 75,482 | 16.7 MiB | 4.2 s |
| 兩岸詞典 | 163,091 | 101,686 | 101,686 | 163,091 | 14.6 MiB | 8.2 s |
| 國語辭典簡編本 | 71,888 | 45,193 | 45,193 | 71,888 | 19.0 MiB | 4.4 s |
| 重編國語辭典修訂本 | 264,866 | 163,916 | 163,916 | 264,866 | 28.5 MiB | 15.8 s |

Every source entry becomes exactly one `.ace` entry with all of its key forms and both readings,
and `ace check` reports every edition pair as identical except for readings. (hanyu7 has four
fewer keys than rows because a few traditional forms repeat within one entry.)

**Source data fixes (2026-09-17).** The original zips had three problems that made merging
unreliable: 兩岸詞典 emitted 17,715 rows with an empty term (simplified form identical to the
traditional one), the pinyin and zhuyin editions differed in content wherever a reading appeared
inside the content (大陸音讀, 本音, 又音: 14,156 / 1,356 / 1,840 rows), and nothing tied a
word's traditional and simplified rows together. Both root converters
(`D:\repos\moe-dict-yomitan`, `D:\repos\mdx-yomitan`) were fixed to follow the conventions in
`docs/ACE_FORMAT.md` (sequence numbers, both reading systems inside content tagged with
`reading-tag`, per-edition CSS, traditional-keyed rows for guifan/hanyu7). Our importer then needs
no dictionary-specific logic at all. A fourth defect was found on the way: `yomichan-dict-builder`
hands JSZip a JavaScript string, and JSZip UTF-8-encodes strings in 16 KiB chunks, so any astral
character (𥥷, 𬶧, 𫗥, 𫐌 …) whose surrogate pair straddles a chunk boundary becomes two U+FFFD.
Both exporters now hand JSZip UTF-8 bytes instead. `ace check <pinyin.zip> <zhuyin.zip>` verifies
all of these conventions for any edition pair.

### Phase 2 — Extension database + import UI  `[ ]`
- [ ] IndexedDB schema (`idb`), import Worker with streaming progress, delete, re-import.
- [ ] Settings → Dictionaries: drag-and-drop `.ace`, list with enable/disable, reorder, details,
      storage usage, delete.
- [ ] Asset serving: `assets` Blobs → object URLs on demand, cache per popup session.

**Checkpoint:** import all 10 dictionaries; DB stats visible; import survives page reload.

### Phase 3 — Lookup engine + popup MVP  `[ ]`
- [ ] Background lookup service (prefix candidates, enabled-dictionary filter, grouping, LRU).
- [ ] Content script scanner: modifier key, `caretPositionFromPoint`, text extraction across nodes,
      match highlight, popup positioning (above/below, viewport clamping), close on scroll/click-out.
- [ ] Popup iframe app: headword + readings header (multi-reading disambiguation), dictionary
      sections with names, structured-content renderer, per-dictionary shadow roots + CSS,
      internal `?query=` links → nested lookup, images from assets, dark/light theme.
- [ ] Reading-tag visibility: content nodes carrying `data-sc-reading-tag` show only for the
      profile's primary reading system (all systems when no preference), per `ACE_FORMAT.md`.
- [ ] Keyboard: Esc to close, Alt+↑/↓ to switch entries (later).

**Checkpoint:** Shift+hover on 读 in a page shows the screenshot-equivalent popup across all
enabled dictionaries in well under 100 ms warm.

### Phase 4 — MDX converter  `[ ]`
- [ ] Input A: `mdict-utils` text export folder (`*.mdx.txt` + `mdd/`). Input B: raw `.mdx`/`.mdd`
      via `js-mdict@6` (MIT; v7 is AGPL and is avoided).
- [ ] `@@@LINK=` → alias keys. HTML sanitization (strip `<script>`, `<link>`, inline handlers),
      `entry://` → internal links, asset references → `ace-asset:` scheme, CSS hoisted into
      `styles.css` with `url()` rewriting, fonts kept as assets.
- [ ] Recipes: per-dictionary rules to split a record into readings/entries and extract the reading
      (`<entry>`+`<pinyin>` for 现汉7, `<hr>`+`<x-pr>` for 规范词典), with a generic fallback
      (one entry, no reading). Recipes are JSON and user-extensible.
- [ ] HTML content renderer in the popup (DOMPurify profile, asset resolution, link rewriting).

**Checkpoint:** both sample MDX dictionaries convert, import, and render with their original CSS
and images; 读 shows dòu and dú as separate entries.

### Phase 5 — Settings depth  `[ ]`
- [ ] Profiles: create/rename/delete/duplicate, per-profile language, dictionaries + order,
      scanning, popup options; active profile switch from toolbar popup.
- [ ] Scanning: modifier (shift/ctrl/alt/none), hover vs click, scan length, delay, scan inside
      the popup, ignore selectors, exclude sites.
- [ ] Appearance: theme (auto/light/dark) for popup and dictionary content, popup size, offset,
      font scale, custom CSS for popup and per-dictionary CSS overrides.
- [ ] Readings: per-profile ranking of reading tags (e.g. zhuyin > pinyin) that selects the primary
      reading shown in the popup header; secondary readings shown smaller or hidden.
- [ ] Backup: export/import settings JSON; export/import dictionary DB (as `.ace` again).

### Phase 6 — Anki integration  `[ ]`
- [ ] AnkiConnect client (optional host permission requested on enable), connection status.
- [ ] Deck / note type / field mapping UI with markers (`{expression}`, `{reading}`, `{glossary}`,
      `{sentence}`, `{dictionary}`, `{url}`, `{frequencies}`, …).
- [ ] Popup buttons: add note; duplicate detection (`findNotes` per headword, cached);
      "view note" opens Anki browser; tag notes.

### Phase 7 — Web-request dictionaries  `[ ]`
- [ ] Dictionary type `web`: URL template, mode `iframe` (embed page) or `fetch` (background fetch +
      sanitized HTML, optional CSS selector to extract), optional host permission per origin.
- [ ] Shown as a regular section in the popup, lazily loaded.

### Phase 8 — Polish, performance, parity  `[ ]`
- [ ] Bloom filters / prefix tables per dictionary; lookup benchmarks in CI.
- [ ] Frequency + pitch meta rendering; kanji/hanzi viewer; search page; clipboard monitor.
- [ ] Japanese language adapter (deinflection rules written from scratch), other languages.
- [ ] Firefox parity pass, store packaging (`wxt zip`), release workflow.

## 5. Decisions and assumptions (please object if any are wrong)

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | **License: MIT.** No Yomitan code is copied (it is GPL-3). | Keeps the project permissive. |
| 2 | **Bun** as package manager/runtime for the monorepo. | Already installed; fast; runs TS directly for the CLI. |
| 3 | **WXT** as the extension framework. | Cross-browser MV3, Svelte module, HMR, zip packaging. |
| 4 | **`.ace` is a ZIP** (JSONL chunks + assets), not a custom binary or SQLite. | Streamable in browsers, inspectable, trivial tooling. |
| 5 | **Popup is an iframe** (extension page) with nested per-dictionary shadow roots. | Bulletproof CSS/JS isolation both ways. |
| 6 | **IndexedDB** for dictionary storage (import from options page via Worker, lookup in background). | Works in Chrome SW and Firefox event page; proven by Yomitan at this scale. |
| 7 | **MDX readings come from recipes**, with built-ins for the two sample dictionaries. | Readings are only inside HTML; there is no universal rule. |
| 8 | **Chinese first**, adapters designed for more languages; Japanese deinflection later. | All sample data is Chinese. |
| 9 | Converter is a **separate CLI** but its core is browser-safe so in-extension conversion can be added later. | Matches the requested workflow without closing the door. |
| 10 | Firefox target is **MV3, Firefox ≥ 128**. | Avoids maintaining an MV2 build. |

## 6. Open questions for the user

1. Any languages besides Chinese needed in the first usable version (Japanese, Korean, European)?
2. Should the extension also accept Yomitan zips directly in the import UI (converting on the fly),
   or is the CLI-only path fine for now?
3. Distribution target: unpacked/dev builds only, or should store packaging be part of Phase 8?
4. Is MIT acceptable, or do you prefer another license?
