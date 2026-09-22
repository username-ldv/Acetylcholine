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

### Phase 2 — Extension database + import UI  `[x]`
- [x] IndexedDB schema (`idb`): `dictionaries` + seven data stores keyed `[d, …]` where `d` is a
      small per-dictionary integer, so a dictionary is deleted with one key-range delete per store
      and no row needs a dictionary index. `keys.key`, `meta.term`, `kanji.character` indexes.
- [x] Import Worker (`entrypoints/import-worker.ts`, a WXT unlisted script): streams the `.ace`
      zip one chunk at a time, writes bounded batches (4 096 entries / 16 384 keys per
      transaction), reports per-stage progress, supports cancel (rolls back), replaces an existing
      copy with the same manifest id, and rejects non-`.ace` files.
- [x] Settings → Dictionaries: drag-and-drop / file picker, import queue with progress and cancel,
      installed list with enable switch, ↑/↓ ordering, details panel, delete with confirmation,
      per-dictionary and total size, `navigator.storage.estimate()` usage.
- [x] Asset serving: `assets` Blobs → object URLs on demand (`AssetUrlCache`, per page).
- [x] `fake-indexeddb` tests for import, lookup, re-import, delete and abort.

**Checkpoint (met, 2026-09-17, Playwright + Chromium 153, `apps/extension/e2e/run.ts`):** all 5
sample `.ace` files (455 572 entries, 653 364 keys, 1 334 assets, 88 MiB of files) imported in
52–67 s sequentially over two runs (largest, 重編國語辭典修訂本: 20–27 s) into ≈ 260 MiB of
IndexedDB; the list, counts and storage line survive a page reload.

### Phase 3 — Lookup engine + popup MVP  `[x]`
- [x] Background lookup service: language-adapter candidates (all prefixes up to `scanLength`,
      code-point aware), one read-only transaction (`getAll` per candidate on the `key` index +
      `get` per entry), enabled-dictionary filter in profile order, grouping by
      (headword ∩ reading) with the scanned form first, 256-entry LRU, invalidated on settings and
      dictionary changes.
- [x] Content script scanner: modifier key (Shift/Ctrl/Alt/none) + hover or click trigger,
      `caretPositionFromPoint` with glyph-box check (no scans over blank space), text extraction
      across inline nodes up to the block boundary, CSS Custom Highlight API (selection fallback),
      popup above/below with viewport clamping and re-positioning on scroll/resize, close on
      click-outside / Esc / (optionally) scroll, excluded sites and ignored selectors.
- [x] Popup iframe app (`lookup.html`): headword + variants + primary/secondary readings per
      group, dictionary titles, structured-content renderer producing Yomitan-compatible
      `data-sc-*` markup, per-dictionary shadow roots with the dictionary's `styles.css`,
      `?query=` / `ace-lookup:` links and hover-inside-popup → nested lookups with a history
      stack (← / Backspace), images from assets, light/dark/auto theme, custom CSS, font scale,
      content-height reporting so the frame shrinks to fit.
- [x] Reading-tag visibility: nodes tagged `data-sc-reading-tag` are shown only for the profile's
      primary reading system (`[data-sc-reading-tag]:not([…="pinyin"]) { display:none }` inside
      each shadow root); the header shows the primary system large and the others small.
- [x] Settings pages for what the popup needs: Scanning, Appearance (theme, size, font scale,
      reading-system order, custom CSS) and a Search page that renders results like the popup.
- [x] Two result layouts (per profile): **by word and pronunciation** (one card per pronunciation,
      every dictionary inside) and **by dictionary** (one block per word; each dictionary lists its
      definitions in turn, each preceded by its reading badge). Entries without a reading form their
      own "no reading" group / come last inside a dictionary. **Readings shown**: primary system
      only, primary large + others small, or all systems alike (also drives reading-tagged content).
      Dictionary name, reading badge and an inline dictionary root share one line. The reading
      badge is only shown when the word has two or more pronunciations across the enabled
      dictionaries (2026-09-19); with one pronunciation it would just repeat the header.
- [x] **Variant-form expansion** (2026-09-22, per-profile setting *Scanning → Lookup*, on by
      default): after the direct query, the other written forms the direct hits list (the MOE
      entry for 圖片 names 图片) are looked up in every enabled dictionary, so dictionaries that
      key a word in one script only (现汉 / 规范词典 key 图片 but not 圖片) still appear. No
      script conversion is involved. An entry found this way is kept when it names the scanned
      word (all of its forms are among the direct hits' forms, or it shares one besides the
      probed form: 现汉's 干 listing 乾) and dropped when its only link is the shared form while it
      also names something else (發 [發, 发] when 髮 was scanned); such a contested form marks the
      entries kept through it *ambiguous*. Alias keys (MDX `@@@LINK`) neither contribute forms
      nor probes. Popup: a dashed “via 图片” badge per entry (amber “· ambiguous” when
      contested); groups reached only through a variant sort after direct ones of the same
      length. Checked on the sample data: 圖片 and 理髮 gain the two simplified dictionaries; 髮
      does not bring 發; 乾 goes from six groups to three (`packages/shared/src/lookup/variants.ts`).
- [ ] Keyboard entry switching (Alt+↑/↓) — later.

**Checkpoint (met, 2026-09-17):** Shift+hover on 读书 in a test page shows the popup with three
groups (读书 dúshū, 读 dú, 读 dòu), each with all five dictionaries and their original CSS;
first popup (iframe creation included) in 107–196 ms over two runs; uncached lookups 0.5–4.4 ms in
the service worker (round trip 1–5.5 ms), cached ≈ 0 ms; nested lookup of 读书人 from a definition
link works; hovering 讀 inside an `<i>` shows 讀 first with 读 as variant; click-outside closes.
Firefox MV3 builds; not yet exercised end-to-end.

### Phase 4 — MDX converter  `[x]`
- [x] Input A: `mdict-utils` text export folder (`mdx/*.mdx.txt` + `mdd/` + sidecar CSS/fonts;
      title/description from the `.title.html` / `.description.html` files), streamed line by
      line. Input B: raw `.mdx` (+ `.mdd`, numbered parts, sidecars) via `js-mdict@6` (MIT; v7 is
      AGPL and is avoided), Node-only in the CLI. Both feed one environment-agnostic `MdxSource`
      (records + resource store) into `convertMdx` in `@acetylcholine/convert`.
- [x] `@@@LINK=` → alias keys to every entry of the (transitively resolved) target, skipped when
      the text already reaches the entry as headword/variant. HTML handled with htmlparser2 /
      domhandler / css-select (no DOM needed): `<script>`, `<iframe>`, … and `on*` attributes
      dropped, `javascript:` URLs removed, `entry://X` → `ace-lookup:X`, `src`/`href`/`url()`
      → `ace-asset:<name>` (exact, case-insensitive and base-name matching against the resource
      store), `<link>`ed stylesheets and `<style>` blocks hoisted once into `styles.css` with
      `url()` rewriting and `html`/`body` selectors mapped to `.ace-html`; only referenced assets
      (images, fonts) are bundled.
- [x] Recipes (`packages/convert/src/mdx/recipe.ts`, zod-validated JSON): `container`, `split`
      (`each` element or `separator` element), `bodyStart` (header region), `reading` (selector,
      attribute, regex replacements, split for equivalent readings such as `xún 又 yīngxún`),
      `variants` (selector or header text, pattern, split, marker stripping), `remove`, and
      `detect` patterns for auto-detection. Built-ins `hanyu7` and `guifan2`, generic fallback
      (one entry per record, no reading). `ace recipes [name]` lists / prints them;
      `ace convert … --recipe <name|file.json>` overrides detection. Reading tag auto-detected.
- [x] Popup: `html` blocks render through the existing DOMPurify renderer; attributes the content
      uses (`<p indent="1">`, `<a type="see">`) are allow-listed by name (never `on*`, `srcdoc`,
      …); `ace-asset:` urls inside dictionary CSS are resolved to object URLs before injection
      and `@font-face` rules are hoisted to the popup document once per dictionary (fonts inside a
      shadow tree are not reliable). The CSS walker (`transformCssRules`, `rewriteCssUrls`,
      `extractFontFaces`) lives in `@acetylcholine/ace` and is shared by converter and renderer.
- [x] Dictionary JavaScript is never run: MV3 forbids dynamic code in extension pages and the
      content is untrusted. Recipes instead declare `interactions` (a click on `selector` toggles
      `toggleClass` on `self` / `parent` / the closest matching ancestor), emitted as
      `data-ace-toggle` attributes and handled by a delegated click handler in the popup;
      `guifan2` reproduces its `toggle_active(this)` 用法说明 card that way. Recipes can also append
      `css` after the dictionary's sheet, e.g. `light-dark()` colours for sheets that hard-code
      black text; the popup sets `color-scheme` from its theme (so `light-dark()` follows it) and
      mirrors the resolved scheme on the iframe element (so `prefers-color-scheme` rules in
      dictionary CSS follow the popup theme, not the OS). `--derive-zhuyin` adds zhuyin readings
      derived from pinyin with `pinyin-to-zhuyin` (MIT, the package behind the Yomitan exports),
      skipping Latin abbreviations such as `AA zhì` and half-converted results (2026-09-19).

**Checkpoint (met, 2026-09-19):**

| MDX dictionary | input | records | `@@@LINK` | `.ace` entries (with reading) | keys | assets | size | time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 现代汉语词典 (第7版) | text export | 72,239 | 4,786 | 70,115 (69,910) | 76,246 | 164 (161 PNG + 2 TTF + 2 WOFF, 30 MiB) | 32.4 MiB | 2.4 s |
| 现代汉语词典 (第7版) | raw `.mdx` + `.mdd` | 72,239 | 4,786 | 70,115 (69,910) | 76,246 | 164 | 32.5 MiB | 12.6 s |
| 现代汉语规范词典 (第2版) | text export | 72,738 | 798 | 73,872 (73,759) | 78,336 | 0 (images are inline `data:` URIs) | 8.5 MiB | 2.7 s |
| 现代汉语规范词典 (第2版) | raw `.mdx` + `.mdd` | 72,738 | 798 | 73,871 (73,758) | 78,335 | 0 | 8.6 MiB | 12.0 s |

With `--derive-zhuyin` (the files used below): 69,780 (现汉) and 73,612 (规范词典) zhuyin readings
added, 32.9 MiB / 9.0 MiB, 5.0 s / 5.8 s. Both recipes are auto-detected; every link resolves
(in 现汉, 5,248 `@@@LINK` keys such as 讀 already reach their entry as variants and add no alias).
Raw and text inputs produce identical key sets; the one-entry difference for 规范词典 comes from
the source files themselves (the raw record for 干 wraps one 另见 line in `<dt>`, the text export
does not). `ace inspect --validate` passes for both files. `ace lookup … 读` prints two entries
(dòu / dú) with 读 | 讀 headwords in each dictionary; 讀 resolves through the variant key,
㑳 / 㓦划 through alias keys, 㖊 carries both `xún` and `yīngxún`. Raw-`.mdx` conversion is slower
because js-mdict re-inflates the record block for every record.

End-to-end (Playwright + Chromium, `apps/extension/e2e/run.ts`, all 7 `.ace` files = 129 MiB):
import 92.7 s total (规范词典 MDX 6.8 s, 现汉 MDX 25.8 s including 30 MiB of fonts and images);
search and Shift+hover on 读书 show every group with all 7 dictionaries; the MDX entries render
as `.ace-html` inside their shadow roots with the original CSS applied (`hw` is `display: block`
in Heiti), the dictionary's Heiti and Songti fonts load from the bundled assets, `entry://` links
work as nested lookups (12 in 读's 词语 list), and in the by-dictionary layout 读 shows the dòu / dú
badges while 读书 (one pronunciation) shows none. The 规范词典 用法说明 card, a declarative toggle standing in for the dictionary's JavaScript, opens on click (note display none → block). With a dark colour scheme emulated, the iframe element mirrors `color-scheme: dark`, the popup switches to its dark theme, the sense numbers that the sheet paints `#000` inherit the light text colour, and the recipe's `light-dark()` colours take their dark branch.

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

### Phase 6 — Anki integration  `[x]`
- [x] AnkiConnect client (`lib/anki/client.ts`: API v6, one POST per action, 10 s timeout, typed
      errors) and the background `AnkiService` (`lib/anki/service.ts`): connection status via
      `requestPermission` (AnkiConnect answers that action for any origin and asks the user once
      inside Anki for unknown ones), deck / note-type / field lists, duplicate check, media
      upload, `addNote`, `guiBrowse`. Access: `optional_host_permissions` `http://*/*` and
      `https://*/*` (Firefox: `host_permissions`), requested with `permissions.request` when the
      integration is switched on; AnkiConnect's own CORS allow-list is the other half and is
      enough by itself.
- [x] Settings → Anki: enable switch (asks for the origin), URL + API key, connection test, deck
      and note-type selects, one template input per field of the chosen note type with clickable
      markers (`{expression}` `{headwords}` `{variants}` `{reading}` `{readings}`
      `{reading:<tag>}` `{glossary}` `{glossary:<dictionary>}` `{glossary-text}` `{dictionary}`
      `{dictionaries}` `{sentence}` `{cloze-prefix}` `{cloze-body}` `{cloze-suffix}` `{url}`
      `{document-title}`; text markers are HTML-escaped, glossary markers are HTML), templates
      suggested from field names, tags, duplicate check (collection / deck), allow duplicates,
      glossary styling on/off. Marker expansion is pure and lives in `@acetylcholine/shared`
      (`anki.ts`).
- [x] Popup: every card (a group, or a word block in the by-dictionary layout) gets `+ Anki` at
      the right of its header. On show the cards are checked against Anki (`findNotes` on the
      note type's first field, cached 30 s): `✓ in Anki` + `view` (opens the Anki browser on the
      notes), `+ Anki`, or a reason (first field empty); after adding, `✓ added` + `view`. The
      glossary is rendered in the popup page (structured content and MDX HTML alike),
      reading-tagged nodes of the other systems dropped, internal links flattened, images renamed
      `ace-<dictionary>-<hash>-<name>` and stored with `storeMediaFile` before `addNote`. Each
      dictionary's stylesheet (popup base rules + `styles.css`, `@font-face` dropped, every
      selector confined to `.ace-glossary-entry[data-dictionary-id=…]` by `scopeCss`) is stored
      once per session as `_ace-<dictionary>.css` and linked from the glossary, so definitions
      look as in the popup without bloating notes. The sentence comes from the scanner (block
      text cut at 。！？!?;； with closing quotes kept, `<br>` as a boundary), on web pages and
      inside the popup alike.
- [ ] `{frequencies}` / `{pitch}` markers wait for meta rendering (Phase 8); dictionary fonts are
      not exported; screenshot / audio markers are not planned.

**Checkpoint (met, 2026-09-22, `apps/extension/e2e/anki.ts` against the user's Anki with
AnkiConnect 6, deck "Acetylcholine Test", note type "CN Mining"):** the settings page connects
and lists decks and fields; Shift+hover on 读书 shows `+ Anki` on all three cards; one click adds
the note in 50–225 ms (three stylesheets uploaded on the first add of a session) with Word 读书,
Reading ㄉㄨˊㄕㄨ, Sentence 我喜欢<b>读书</b>，读书使人进步。, the glossary with one `<link>` per
dictionary, and the page title + URL; a fresh hover shows `✓ in Anki` + `view`; 剑, already in
another deck of the collection, is reported as a duplicate; 俎 added from the Search page carries
its picture (`ace-mdx-…-125.PNG`, present in the media folder). Chrome needed no host permission
in that run because AnkiConnect echoes the extension origin in its CORS headers; the client's
`fetch` must be bound to `globalThis` (calling it as a method throws "Illegal invocation").

### Phase 7 — Web-request dictionaries  `[ ]`
Web dictionaries are configured in the extension, not converted. They are also the way to use
dictionaries whose JavaScript matters (decision 18): in `iframe` mode the browser runs the site's
scripts in the site's own origin, exactly as in a tab, and the extension never loads any code.

- [ ] Dictionary type `web`: display title, URL template (`{term}` URL-encoded; `{termRaw}`,
      `{reading}` later), and a mode:
      - `iframe`: the page is embedded in an iframe inside the popup with
        `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"` (no top-level
        navigation, so a site cannot navigate the popup or the page away). Fixed height per
        dictionary with scrolling; the popup's `color-scheme` is mirrored on the frame so sites
        with a dark mode follow the theme.
      - `fetch`: the background fetches the page, extracts an optional CSS selector, and renders
        the HTML through the existing sanitizing renderer (no scripts), cached for the session.
        Works on sites that refuse framing; the content is available to Anki export.
- [ ] Per-origin opt-ins, each requested only when the user turns it on: the host permission
      (required for `fetch` and for the two helpers below), a `declarativeNetRequest` rule that
      strips `X-Frame-Options` / `frame-ancestors` on responses for frames opened by the popup
      (sites that block embedding), and a small content script injected into the embedded page
      that reports its height and enables Shift+hover lookups inside it.
- [ ] Shown as a regular section in the popup in dictionary order, loaded lazily (only when the
      section becomes visible); "no result" heuristic in `fetch` mode (selector matched nothing
      → section hidden); an "open in tab" link in both modes.
- [ ] Privacy note in the settings: every lookup sends the scanned term to the site's URL.
- [ ] Optional: `ace serve <dict.mdx | export folder>`, a local HTTP server in the CLI that
      serves MDX records as pages with their original CSS, JavaScript and `.mdd` resources
      (js-mdict is already there), so a script-heavy MDX dictionary becomes a local web
      dictionary without third-party tools.

**The two configurations this phase must make trivial:**

| | online third-party site | locally hosted dictionary |
| --- | --- | --- |
| example | 百度汉语: `https://hanyu.baidu.com/hanyu-page/term/detail?wd={term}&ptype=zici` (the site's own tabs, audio and stroke animations keep working) | an MDX served locally, `http://127.0.0.1:8000/{term}` (ninja33's `mdx-server`, or the optional `ace serve`); or any static HTML dictionary behind `python -m http.server` |
| mode | `iframe` (its JavaScript is the point) | `iframe` |
| needs | host permission for `hanyu.baidu.com`; framing headers: none sent (checked 2026-09-19: the response carries neither `X-Frame-Options` nor a CSP); script-based frame busting, if any, cannot navigate the popup because the sandbox omits `allow-top-navigation` | nothing beyond a `127.0.0.1` host permission |
| privacy | the term is sent to Baidu on every lookup | stays on the machine |

**Checkpoint:** both examples appear as sections in the popup for 词典; the Baidu page is
interactive inside the popup; the local MDX page renders with its scripts running; and a
`fetch`-mode dictionary renders through the sanitizer and exports to Anki.

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
| 11 | **Data rows carry a small dictionary number** (`d`) as the first key component. | One range delete per store removes a dictionary; no per-row dictionary index or string id. |
| 12 | **Lookups run in the background service worker**; the popup reads assets and stylesheets from IndexedDB directly. | Chrome messaging is JSON-only (no Blobs); the LRU lives where it is shared by all tabs. |
| 13 | **Grouping** = same headword and, within a shared reading system, the same reading; disjoint systems attach to the first matching group; reading-less entries stay separate. | Keeps dú and dòu apart across five dictionaries without dictionary-specific rules. |
| 14 | **E2E checks use Playwright with its Chromium build**, not branded Chrome. | Chrome 137+ ignores `--load-extension`. |
| 15 | **MDX structure comes from JSON recipes** (selectors + regexes) rather than per-dictionary code; the converter core has no file access and uses htmlparser2 (no DOM). | Users can add dictionaries without touching TypeScript; the same code can later run inside the extension. |
| 16 | **MDX readings keep the dictionary's own system** (pinyin here) with the same separator clean-up as the Yomitan exports (`dú//shū` → `dú shū`, `·`/`-` → space), so grouping across MDX and Yomitan copies of one dictionary works. Zhuyin is derived only on request (`--derive-zhuyin`, `pinyin-to-zhuyin`). | Conversion stays generic; the derived system is opt-in and Chinese-specific. |
| 17 | **`@font-face` rules are hoisted out of shadow roots** into the popup document and `body`/`html` selectors become `.ace-html`. | Fonts declared inside a shadow tree do not reliably apply; shadow roots have no body. |
| 18 | **Dictionary JavaScript is never executed by the extension.** Interactive bits are declared in recipes (`interactions`: click → class toggle) and dark-mode fixes as recipe `css` with `light-dark()`. Dictionaries whose scripts matter are used as web-request dictionaries in `iframe` mode (Phase 7), where the browser runs them in their own origin. | MV3 extension pages cannot run code loaded from storage (Tampermonkey-style `userScripts` only target web pages), and dictionary JS is untrusted; the common patterns (collapsible notes) are class toggles anyway. |
| 19 | **Cross-script coverage comes from the dictionaries' own variant lists, not from a converter.** The lookup re-queries the forms the direct hits name and marks what it finds; simplified → traditional conversion is never guessed. | OpenCC-style conversion is ambiguous (发 → 發/髮), while a traditional dictionary that lists 图片 for 圖片 is authoritative. |

## 6. Open questions for the user

Answered 2026-09-17:

1. Languages besides Chinese in the first usable version: **no** — Chinese only; others later.
2. Yomitan zips directly in the import UI: **not now** — CLI conversion is the path.
3. Distribution: **dev / unpacked builds only** for now; store packaging stays in Phase 8.
4. License: **MIT** is fine.

Open:

5. Popup on CSP-strict pages: sites whose `frame-src` blocks `chrome-extension:` cannot host the
   iframe. A shadow-DOM fallback (weaker CSS isolation) could be added if this shows up in practice.
6. Group display: when the same word has readings in different systems only (e.g. a Cantonese
   dictionary with jyutping), it attaches to the first group that shares a headword. Say if you
   would rather see such entries in every group or in their own group. (Entries with *no* reading
   already form their own group, per your 2026-09-17 feedback.)
7. MDX `@@@LINK=` sub-headwords: in 规范词典, compounds like 㓦划 are `@@@LINK=㓦` and appear as an
   `<x-hwp>` block inside 㓦's entry. The converter makes 㓦划 an alias key to the whole 㓦 entry
   (generic behaviour); your Yomitan exporter instead created a separate 㓦划 row with the
   `x-hwp` reading. Say if you want a recipe rule that extracts such sub-headwords into their
   own entries.
8. ~~MDX readings are pinyin only.~~ Answered 2026-09-19: `--derive-zhuyin` adds zhuyin with
   `pinyin-to-zhuyin`, the package your exporters use.
