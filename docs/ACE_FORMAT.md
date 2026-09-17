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
(`<hw>`, `<x-pr>`, …) are allowed because the dictionary CSS styles them.

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
`url()` references to fonts/images are rewritten to `ace-asset:<path>` by the converter.

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
   each in its own node tagged `data: { "reading-tag": "pinyin" }` / `"zhuyin"`; the edition's
   `styles.css` hides the other system with `[data-sc-reading-tag="zhuyin"] { display: none }`.
   The importer strips every CSS rule that targets `data-sc-reading-tag`; the `.ace` renderer shows
   the nodes matching the profile's primary reading tag instead.
3. **No empty terms.** Rows whose term is empty are skipped (with a warning). When the
   `--variant-data-values` option is given, a headword can be recovered from marked content.
4. **Every lookup form is a row.** If a word should be found under a variant spelling, emit a row
   for it (sharing the sequence) rather than relying on the importer to dig it out of the content.

## Versioning

`aceVersion` is bumped only for breaking changes. Readers must reject a higher major than they
know. Unknown fields must be ignored by readers so minor additions stay compatible.
