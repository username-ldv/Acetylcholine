/**
 * Recipes describe how one MDX dictionary's HTML records map onto `.ace` entries: how a record is
 * split into pronunciations, where the reading is, and where variant headwords (traditional forms)
 * hide. They are plain JSON so users can add their own; the built-ins cover the sample
 * dictionaries and a generic fallback (one entry per record, no reading).
 */
import { z } from 'zod';

const regexString = z.string().refine(
  (s) => {
    try {
      new RegExp(s);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'must be a valid regular expression' },
);

export const mdxRecipeSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  /** Auto-detection: every given pattern must match (the title, resp. a sample of record HTML). */
  detect: z
    .object({
      title: regexString.optional(),
      html: regexString.optional(),
    })
    .optional(),
  /**
   * CSS selector of the element wrapping a record's content (e.g. `div.HYGF2`). Sections are
   * looked for inside it and each section is wrapped in a copy of it, so its CSS keeps applying.
   */
  container: z.string().optional(),
  /**
   * How a record is split into entries: `each` makes every matching element an entry
   * (`entry` in 现汉7); `separator` splits the container's children at matching elements
   * (`hr` in 规范词典). Without `split` the whole record is one entry.
   */
  split: z.union([z.object({ each: z.string() }), z.object({ separator: z.string() })]).optional(),
  /**
   * Selector of the first "body" element of a section (e.g. `dt`). Everything before it is the
   * section header; the reading and header-text variants are only searched there.
   */
  bodyStart: z.string().optional(),
  reading: z
    .object({
      /** Selector of the element holding the reading (`hwg > pinyin`, `x-pr`). */
      selector: z.string(),
      /** Read this attribute instead of the element's text. */
      attribute: z.string().optional(),
      /** Regex replacements applied in order (global), e.g. drop notes in parentheses. */
      replace: z.array(z.tuple([regexString, z.string()])).optional(),
      /** Regex separating equivalent readings (`又` in 现汉7); each becomes a reading. */
      split: regexString.optional(),
      /** Reading tag; auto-detected from the readings when omitted. */
      tag: z.string().optional(),
    })
    .optional(),
  variants: z
    .object({
      /** Element whose text lists the variants (`hw`); default: the section header text. */
      selector: z.string().optional(),
      /** Regex whose first group captures the variant list, e.g. `（([^）]+)）`. */
      pattern: regexString,
      /** Regex splitting the list into forms; default `[、，,/／]`. */
      split: regexString.optional(),
      /** Regex of marker characters removed from each form (`*`, `△`, circled numbers …). */
      strip: regexString.optional(),
    })
    .optional(),
  /** Selectors of elements dropped from the content (scripts and stylesheets always are). */
  remove: z.array(z.string()).optional(),
  /**
   * Extra CSS appended after the dictionary's own stylesheet: dark-mode fixes with
   * `light-dark()`, layout tweaks. The popup sets `color-scheme` from its theme.
   */
  css: z.string().optional(),
  /**
   * Declarative stand-ins for the dictionary's JavaScript, which is never run: clicking an
   * element matching `selector` toggles `toggleClass` on `target` (`self`, `parent`, or a
   * selector resolved with `closest()`). Emitted as `data-ace-toggle` attributes.
   */
  interactions: z
    .array(
      z.object({
        selector: z.string(),
        toggleClass: z.string().min(1),
        target: z.string().optional(),
      }),
    )
    .optional(),
});

export type MdxRecipe = z.infer<typeof mdxRecipeSchema>;

export const GENERIC_RECIPE: MdxRecipe = {
  name: 'generic',
  description: 'One entry per record, no reading (fallback for unknown dictionaries).',
};

export const BUILTIN_RECIPES: readonly MdxRecipe[] = [
  {
    name: 'hanyu7',
    description:
      '现代汉语词典 (第7版): one <entry> per pronunciation, reading in <hwg><pinyin>, traditional forms in parentheses inside <hw>.',
    detect: { html: '<entry[\\s>][\\s\\S]*?<hwg>' },
    split: { each: 'entry' },
    reading: {
      selector: 'hwg > pinyin',
      replace: [
        ['（[^）]*）', ''],
        ['[-·’]|//', ' '],
      ],
      split: '\\s*又\\s*',
    },
    variants: {
      selector: 'hw',
      pattern: '（([^）]+)）',
      strip: '[\\s*＊⁎⁑※△①-⑳㉑-㉟]',
    },
  },
  {
    name: 'guifan2',
    description:
      '现代汉语规范词典 (第2版): pronunciations separated by <hr> inside div.HYGF2, reading in <x-pr>, traditional form in parentheses after it.',
    detect: { html: 'class="HYGF2"' },
    container: 'div.HYGF2',
    split: { separator: 'hr' },
    bodyStart: 'dt',
    reading: {
      selector: 'x-pr',
      replace: [['-|//', ' ']],
    },
    variants: {
      pattern: '（([^）]+)）',
    },
    css: [
      '/* Acetylcholine: the sheet hard-codes colours for a light page. */',
      'x-a, x-sn, x-m { color: inherit; }',
      'x-ex { color: light-dark(darkslategrey, #a3b5b5); }',
      'x-gg, x-etym { color: light-dark(darkgreen, #8fd18f); }',
      'x-r, x-sbl0, x-sbl, x-sbl1, x-sbl2, x-sbl3, x-sbl4, x-ref:after, dd:before { color: light-dark(#942923, #e69a8a); }',
      'a:visited { color: light-dark(#800080, #d3a4f7); }',
      '.collapse { background-color: light-dark(rgba(199, 110, 6, 0.1), rgba(199, 110, 6, 0.28)); }',
    ].join('\n'),
    // HYGF2.js: toggle_active(ctl) toggles "is-active" on the clicked label's parent.
    interactions: [{ selector: '.unbox > .x-lb', toggleClass: 'is-active', target: 'parent' }],
  },
  GENERIC_RECIPE,
];

/** Validates a user-supplied recipe (parsed JSON). Throws with a readable message. */
export function parseRecipe(input: unknown): MdxRecipe {
  const res = mdxRecipeSchema.safeParse(input);
  if (!res.success) {
    const issues = res.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid MDX recipe: ${issues}`);
  }
  return res.data;
}

export function findRecipe(name: string, extra: readonly MdxRecipe[] = []): MdxRecipe | undefined {
  return [...extra, ...BUILTIN_RECIPES].find((r) => r.name === name);
}

/**
 * Picks the first recipe whose `detect` patterns all match the title / the sample HTML. Recipes
 * without `detect` never match automatically; `generic` is the fallback.
 */
export function detectRecipe(
  title: string,
  sampleHtml: string,
  extra: readonly MdxRecipe[] = [],
): MdxRecipe {
  for (const recipe of [...extra, ...BUILTIN_RECIPES]) {
    const d = recipe.detect;
    if (!d || (d.title === undefined && d.html === undefined)) continue;
    if (d.title !== undefined && !new RegExp(d.title).test(title)) continue;
    if (d.html !== undefined && !new RegExp(d.html).test(sampleHtml)) continue;
    return recipe;
  }
  return GENERIC_RECIPE;
}
