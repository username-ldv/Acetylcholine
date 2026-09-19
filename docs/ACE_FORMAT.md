# The `.ace` dictionary format — v1

`.ace` is Acetylcholine's unified dictionary container. Every input format (Yomitan, MDX, …) is
converted into it by the `ace` CLI, and the extension only ever imports `.ace` files.

## Container

A `.ace` file is a standard **ZIP** archive (deflate or store). Layout:

```
manifest.json              required — metadata, counts, file lists
styles.css                 optional — dictionary CSS, applied inside the dictionary's own shadow root
tags.json                  optional — tag definitions
entries/00001.jsonl …      one AceEntry per line
keys/00001.jsonl …         one AceKey per line
meta/00001.jsonl …         one AceMeta per line (frequency / pitch / IPA)
kanji/00001.jsonl …        one AceKanji per line
kanji-meta/00001.jsonl …   one AceKanjiMeta per line
assets/<path>              images, fonts, … referenced by content
```

Chunk files are newline-delimited JSON (UTF-8, `\n`). Chunking allows streaming import with bounded
memory. Chunk order is given by `manifest.files.*` arrays and must be respected (entry ids are
dense and ascending).

## `manifest.json`

```jsonc
{
  "aceVersion": 1,
  "id": "yomitan:guifan-pinyin:2026/02/12.1",   // stable identifier; import de-duplicates on it
  "title": "现代汉语规范词典 拼音",
  "revision": "2026/02/12.1",
  "author": "shadow",
  "description": "…",
  "attribution": "外语教学与研究出版社 (2010)",
  "url": "https://…",                            // optional source url
  "sourceLanguage": "zh",                        // ISO 639, language of the headwords
  "targetLanguage": "zh",                        // language of the definitions
  "readingTags": ["pinyin", "zhuyin"],           // union of reading tags used by entries
  "source": { "format": "yomitan", "formatVersion": 3 },   // converter-specific provenance
  "generator": "acetylcholine-cli/0.1.0",
  "createdAt": "2026-09-17T00:00:00Z",
  "sequenced": false,
  "frequencyMode": "rank-based",                 // optional
  "contentKinds": ["structured"],                // which AceContent types appear
  "counts": { "entries": 74668, "keys": 149000, "meta": 0, "tags": 0, "kanji": 0, "kanjiMeta": 0, "assets": 314 },
  "files": {
    "entries": ["entries/00001.jsonl", "…"],
    "keys": ["keys/00001.jsonl"],
    "meta": [],
    "kanji": [],
    "kanjiMeta": [],
    "assets": ["img/abc.png", "…"],            // paths relative to assets/
    "styles": "styles.css",                      // optional
    "tags": "tags.json"                          // optional
  }
}
```

## Entries — `AceEntry`

One entry is one *sense block*: a set of display headwords, a set of tagged readings, and the
content shown for them.

- **Headwords** are the display forms that share this content (simplified / traditional, spelling
  variants). Index 0 is canonical.
- **Readings** are every pronunciation representation that applies to this content: the same
  pronunciation in several systems (`dú` tagged `pinyin`, `ㄉㄨˊ` tagged `zhuyin`) or equivalent
  pronunciations (`shéi` / `shuí`). Tags are free strings; the first tag is by convention the
  reading system. The extension lets the user rank tags (e.g. zhuyin before pinyin) to choose the
  primary reading shown, with the others available as secondary readings.
- Pronunciations that carry **different meanings** (读 dú "to read" vs 读 dòu "pause") are
  separate entries, because their content differs.

Converters therefore merge rows whose headword set and content are identical and union their
readings; feeding a pinyin edition and a zhuyin edition of the same dictionary into one conversion
yields one entry per sense with both readings.

```jsonc
{
  "id": 12,                       // dense integer, unique within the dictionary
  "headwords": ["读", "讀"],       // display forms; [0] is canonical, others are variants
  "readings": [                   // [] when the dictionary has no readings
    { "text": "dú",   "tags": ["pinyin"] },
    { "text": "ㄉㄨˊ", "tags": ["zhuyin"] }
  ],
  "content": [ …AceContent ],     // ordered blocks
  "tags": ["v"],                  // definition tags (see tags.json)
  "termTags": [],                 // tags about the term itself (Yomitan "term tags")
  "rules": [],                    // deinflection rule ids (language adapters)
  "score": 0,                     // popularity; higher sorts first
  "sequence": -1                  // groups related entries across readings; -1 = none
}
```

### `AceContent`

```ts
type AceContent =
  | { type: 'text'; text: string }
  | { type: 'structured'; content: StructuredContent }      // Yomitan structured-content tree, verbatim
  | { type: 'html'; html: string }                           // sanitized HTML (MDX); see rules below
  | { type: 'image'; path: string; width?; height?; title?; alt?; description?; pixelated?;
      imageRendering?; appearance?; background?; collapsed?; collapsible? }
  | { type: 'deinflection'; term: string; rules: string[] };   // Yomitan "[term, rules]" glossary rows
```

**Asset references.** Inside `structured` (`img.path`) and `image.path` the path is relative to the
`assets/` directory. Inside `html`, every `src`/`href`/`url()` that points to an asset is rewritten
by the converter to `ace-asset:<path>`; the renderer resolves it to a blob URL from the imported
asset store.

**Internal links.** Links to other headwords are `?query=<urlencoded term>` in `structured` content
(Yomitan convention, kept verbatim) and `ace-lookup:<term>` in `html` content (converted from
MDX `entry://`). Both open a nested lookup in the popup.

**HTML content rules.** Converters must remove `<script>`, `<link>`, `<style>` (its text is hoisted
to `styles.css`), `<iframe>`, `<object>`, `<embed>`, all `on*` attributes, and `javascript:` URLs.
The renderer sanitizes again with DOMPurify before insertion; unknown custom elements
(`<hw>`, `<x-pr>`, …) and the attributes the content uses (`<p indent="1">`) are allowed because
the dictionary CSS depends on them. Event handlers and embedding attributes never pass.

**Interactions.** Dictionary scripts are never executed. An element carrying
`data-ace-toggle="<classes>"` and optionally `data-ace-toggle-target="self|parent|<selector>"`
toggles those classes on the target when clicked (the renderer installs one delegated handler).
This covers collapsible notes and similar blocks whose CSS keys off a class.

## Keys — `AceKey`

Compact arrays: `[key, entryId, kind]`.

| kind | meaning |
| --- | --- |
| 0 `headword` | the canonical headword |
| 1 `variant` | another display form of the same entry (讀 for 读) |
| 2 `reading` | one of the entry's readings is searchable (kana readings in Japanese) |
| 3 `alias` | a redirect key (MDX `@@@LINK=`) |

Keys are stored NFC-normalized, exactly as they should be matched (the extension does exact
matching after NFC on the query; case folding is a language-adapter decision). One entry usually
has 1–3 keys; the same key may point to many entries.

## Meta — `AceMeta`

`[term, "freq" | "pitch" | "ipa", data]` with data exactly as in Yomitan's `term_meta_bank` v3.

## Tags — `tags.json`

Array of `[name, category, order, notes, score]` (Yomitan `tag_bank` v3 rows).

## Kanji — `AceKanji`, `AceKanjiMeta`

Rows identical to Yomitan `kanji_bank` v3 (`[character, onyomi, kunyomi, tags, meanings, stats]`)
and `kanji_meta_bank` v3 (`[character, "freq", data]`).

## `styles.css`

Applied inside a shadow root that wraps this dictionary's content only. Selectors therefore never
need a dictionary prefix. Yomitan dictionaries use `[data-sc-<name>=…]` attribute selectors, which
the structured-content renderer produces; MDX dictionaries use whatever selectors their CSS has.
`url()` references to fonts/images are rewritten to `ace-asset:<path>` by the converter, which
the popup resolves to object URLs before injecting the sheet. `@font-face` rules are moved to the
popup document (fonts declared inside a shadow tree are not reliably available to it), so font
family names should be reasonably unique. Selectors `html` and `body` are rewritten to the content
root `.ace-html` at conversion time, since neither element exists inside a shadow root. The popup
sets `color-scheme` from its theme on the document root (inherited by the shadow trees) and on the
popup iframe element, so `light-dark()` values and `@media (prefers-color-scheme)` rules in
dictionary CSS follow the popup theme rather than the operating system.

## Conventions for dictionary authors (Yomitan input)

The Yomitan importer is generic: it has no knowledge of any particular dictionary. Dictionaries
that follow these conventions get the best results.

1. **Sequence numbers.** Set `sequenced: true` in `index.json` and give every source entry one
   sequence number, shared by all of its rows (traditional and simplified forms, several editions
   of the same dictionary). The importer merges rows with the same sequence **and** identical
   content into one entry: their terms become the headwords, their readings are unioned. Rows with
   the same sequence but different content (senses) stay separate entries. Unsequenced
   dictionaries merge only rows with identical headword set and content.
2. **Identical content across editions.** A pinyin edition and a zhuyin edition should differ only
   in the reading field. Readings that appear *inside* the content are emitted for both systems,
   each in its own node tagged `data: { "readingTag": "pinyin" }` / `"zhuyin"`; the edition's
   `styles.css` hides the other system with `[data-sc-reading-tag="zhuyin"] { display: none }`.
   The importer strips every CSS rule that targets `data-sc-reading-tag`; the `.ace` renderer shows
   the nodes matching the profile's primary reading tag instead.

   Structured-content `data` keys must be camelCase: Yomitan (and the `.ace` renderer) assign them
   through `element.dataset` as `sc<Key>`, which the DOM exposes as `data-sc-<kebab-case>`. A key
   containing a hyphen is rejected by the DOM and silently dropped.
3. **No empty terms.** Rows whose term is empty are skipped (with a warning). When the
   `--variant-data-values` option is given, a headword can be recovered from marked content.
4. **Every lookup form is a row.** If a word should be found under a variant spelling, emit a row
   for it (sharing the sequence) rather than relying on the importer to dig it out of the content.

## Conventions for MDX input

MDX records are opaque HTML, so the converter relies on a **recipe** (JSON, see `ace recipes`) per
dictionary family: an optional `container` selector, a `split` rule (`each` element or
`separator` element), the `reading` selector with clean-up replacements and a split for
equivalent readings, and a `variants` pattern for traditional/alternative forms. Recipes are
auto-detected through their `detect` patterns; unknown dictionaries get one entry per record and no
reading. Each section becomes one entry whose `content` is a single `html` block; headwords are
the record key plus the variants; `@@@LINK=` records become `alias` keys pointing at every entry of
the (transitively resolved) target; `sequence` is the record's ordinal so the entries of one record
stay related. A recipe may also append `css` (dark-mode fixes with `light-dark()`, layout tweaks)
and declare `interactions` (`selector` → `toggleClass` on `target`) that stand in for the
dictionary's JavaScript. `--derive-zhuyin` adds zhuyin readings computed from pinyin ones.

## Versioning

`aceVersion` is bumped only for breaking changes. Readers must reject a higher major than they
know. Unknown fields must be ignored by readers so minor additions stay compatible.
