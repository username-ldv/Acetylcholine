import { describe, expect, it } from 'vitest';
import { cssUrls, extractFontFaces, rewriteCssUrls, transformCssRules } from '../src/css.ts';

describe('transformCssRules', () => {
  it('rewrites and drops rules, recursing into at-rule blocks', () => {
    const css = [
      '/* c */ body { color: red; }',
      '@media (min-width: 1px) {',
      '  body, .x { margin: 0; }',
      '  .drop { display: none; }',
      '}',
      '.keep { content: "{not a rule}"; }',
    ].join('\n');
    const out = transformCssRules(css, (rule) => {
      if (rule.isAtRule) return rule.prelude;
      if (rule.prelude === '.drop') return null;
      return rule.prelude.replace(/\bbody\b/g, '.root');
    });
    // a rewritten prelude loses its comments; unchanged ones keep them
    expect(out.startsWith('.root { color: red; }')).toBe(true);
    expect(out).toContain('.root, .x {');
    expect(out).not.toContain('.drop');
    expect(out).toContain('.keep { content: "{not a rule}"; }');
    expect(out).toContain('@media (min-width: 1px) {');
  });

  it('keeps the original text when the visitor returns the prelude unchanged', () => {
    const css = 'a  /* x */ { color: red; }\n';
    expect(transformCssRules(css, (r) => r.prelude)).toBe(css);
  });

  it('exposes rule bodies and depth', () => {
    const seen: [string, string, number][] = [];
    transformCssRules('@supports (a: b) { p { c: d; } }', (r) => {
      seen.push([r.prelude, r.body.trim(), r.depth]);
      return r.prelude;
    });
    expect(seen).toEqual([
      ['@supports (a: b)', 'p { c: d; }', 0],
      ['p', 'c: d;', 1],
    ]);
  });
});

describe('rewriteCssUrls', () => {
  it('handles quoted and bare urls and leaves untouched ones alone', () => {
    const css =
      "@font-face { src: url('hei.ttf'), url(\"song.woff\") format('woff'); }\n.a { background: url(img/x.png) } .b { background: url(data:image/png;base64,AAAA) }";
    const out = rewriteCssUrls(css, (url) => (url.startsWith('data:') ? null : `ace-asset:${url}`));
    expect(out).toContain('url("ace-asset:hei.ttf")');
    expect(out).toContain('url("ace-asset:song.woff") format(\'woff\')');
    expect(out).toContain('url("ace-asset:img/x.png")');
    expect(out).toContain('url(data:image/png;base64,AAAA)');
    expect(cssUrls(css)).toEqual([
      'hei.ttf',
      'song.woff',
      'img/x.png',
      'data:image/png;base64,AAAA',
    ]);
  });
});

describe('extractFontFaces', () => {
  it('splits @font-face rules from the rest', () => {
    const css =
      '@font-face {\n  font-family: A;\n  src: url(a.ttf);\n}\nbody { font-family: A; }\n';
    const { fontFaces, rest } = extractFontFaces(css);
    expect(fontFaces).toBe('@font-face {\n  font-family: A;\n  src: url(a.ttf);\n}');
    expect(rest).toBe('\nbody { font-family: A; }\n');
    expect(extractFontFaces('a { b: c; }')).toEqual({ fontFaces: '', rest: 'a { b: c; }' });
  });
});
