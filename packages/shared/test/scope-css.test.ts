import { describe, expect, it } from 'vitest';
import { scopeCss } from '../src/render/css.ts';

const SCOPE = '.ace-glossary-entry[data-dictionary-id="d"]';

describe('scopeCss', () => {
  it('prefixes every selector of a list and maps :host / :root to the scope', () => {
    const css = 'hw, x-sn:first-child { display: block } :host { color: red } :root{--a:1}';
    expect(scopeCss(css, SCOPE)).toBe(
      `${SCOPE} hw, ${SCOPE} x-sn:first-child { display: block } ${SCOPE} { color: red } ${SCOPE} {--a:1}`,
    );
  });

  it('keeps commas inside functions and strings together', () => {
    const css = ':is(a, b) [t="x,y"] { m: 0 }';
    expect(scopeCss(css, 's')).toBe('s :is(a, b) [t="x,y"] { m: 0 }');
  });

  it('descends into media queries, leaves keyframe steps alone and drops font faces', () => {
    const css = [
      '@media (max-width: 400px) { p { x: 1 } }',
      '@keyframes blink { from { o: 0 } 50% { o: 1 } }',
      '@font-face { font-family: F; src: url(ace-asset:f.ttf) }',
      'q { y: 2 }',
    ].join('\n');
    expect(scopeCss(css, 's')).toBe(
      [
        '@media (max-width: 400px) { s p { x: 1 } }',
        '@keyframes blink { from { o: 0 } 50% { o: 1 } }',
        '',
        's q { y: 2 }',
      ].join('\n'),
    );
  });
});
