import { describe, expect, it } from 'vitest';
import { resolveCssAssets } from '../src/render/css.ts';

describe('resolveCssAssets', () => {
  it('replaces ace-asset urls with resolved URLs and keeps unresolved ones', async () => {
    const css =
      '@font-face { src: url("ace-asset:hei.ttf"), url(ace-asset:missing.woff); }\n.a { background: url(ace-asset:img%2Fx.png) } .b { background: url(data:x) }';
    const seen: string[] = [];
    const out = await resolveCssAssets(css, async (path) => {
      seen.push(path);
      return path === 'hei.ttf' || path === 'img/x.png' ? `blob:${path}` : null;
    });
    expect(seen.sort()).toEqual(['hei.ttf', 'img/x.png', 'missing.woff']);
    expect(out).toContain('url("blob:hei.ttf")');
    expect(out).toContain('url(ace-asset:missing.woff)');
    expect(out).toContain('url("blob:img/x.png")');
    expect(out).toContain('url(data:x)');
  });

  it('is a no-op without asset references', async () => {
    let calls = 0;
    const css = 'a { color: red }';
    expect(
      await resolveCssAssets(css, async () => {
        calls++;
        return null;
      }),
    ).toBe(css);
    expect(calls).toBe(0);
  });
});
