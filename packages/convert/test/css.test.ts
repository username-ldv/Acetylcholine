import { describe, expect, it } from 'vitest';
import { stripReadingTagRules } from '../src/css.ts';

describe('stripReadingTagRules', () => {
  it('returns css untouched when there is nothing to strip', () => {
    const css = 'a { color: red; }\n[data-sc-x="y"] { display: block; }\n';
    expect(stripReadingTagRules(css)).toBe(css);
  });

  it('removes top-level rules that target the reading tag', () => {
    const css = [
      '[data-sc-moedict="first-row-parent"] {',
      '  display: inline-flex;',
      '}',
      '/* pinyin edition */',
      '[data-sc-reading-tag="zhuyin"] {',
      '  display: none;',
      '}',
      'a { color: #b971b9; }',
      '',
    ].join('\n');
    const out = stripReadingTagRules(css);
    expect(out).not.toContain('data-sc-reading-tag');
    expect(out).toContain('[data-sc-moedict="first-row-parent"] {\n  display: inline-flex;\n}');
    expect(out).toContain('a { color: #b971b9; }');
  });

  it('removes nested rules and rules inside at-rule blocks, keeps siblings', () => {
    const css = [
      '[data-sc-class="collapse"] {',
      '  display: block;',
      '  [data-sc-reading-tag="pinyin"] { display: none; }',
      '  [data-sc-class="unbox"] { color: red; }',
      '}',
      '@media (max-width: 600px) {',
      '  [data-sc-reading-tag="zhuyin"], .x { display: none; }',
      '  .y { color: "{not a brace}"; }',
      '}',
    ].join('\n');
    const out = stripReadingTagRules(css);
    expect(out).not.toContain('data-sc-reading-tag');
    expect(out).toContain('display: block;');
    expect(out).toContain('[data-sc-class="unbox"] { color: red; }');
    expect(out).toContain('.y { color: "{not a brace}"; }');
    expect(out).not.toContain('.x {');
  });

  it('does not confuse the attribute name inside strings or comments of kept rules', () => {
    const css =
      '.a { content: "data-sc-reading-tag"; } /* data-sc-reading-tag */ .b { color: red; }';
    const out = stripReadingTagRules(css);
    expect(out).toContain('.a { content: "data-sc-reading-tag"; }');
    expect(out).toContain('.b { color: red; }');
  });
});
