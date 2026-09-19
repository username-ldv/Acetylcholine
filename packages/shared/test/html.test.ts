// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { collectAttributeNames, renderHtml } from '../src/render/html.ts';

const ctx = () => ({
  resolveAsset: vi.fn(async (path: string) => (path === '001.PNG' ? 'blob:001' : null)),
  onLookup: vi.fn(),
});

describe('renderHtml (MDX content)', () => {
  it('keeps custom elements and dictionary attributes on standard elements', () => {
    const root = renderHtml(
      '<entry id="1"><hwg><hw>读（讀）</hw><pinyin>dú</pinyin></hwg><p indent="1">x</p><a href="ace-lookup:句读" type="see">句读</a><x-pr id="dú">dú</x-pr></entry>',
      ctx(),
    );
    expect(root.querySelector('entry')?.getAttribute('id')).toBe('1');
    expect(root.querySelector('hwg > pinyin')?.textContent).toBe('dú');
    expect(root.querySelector('p')?.getAttribute('indent')).toBe('1');
    expect(root.querySelector('a')?.getAttribute('type')).toBe('see');
    expect(root.querySelector('a')?.getAttribute('data-ace-lookup')).toBe('句读');
    expect(root.querySelector('x-pr')?.getAttribute('id')).toBe('dú');
  });

  it('never lets event handlers or embedding attributes through', () => {
    const html = '<p onclick="x()" srcdoc="y" indent="2">a</p><iframe srcdoc="z"></iframe>';
    expect(collectAttributeNames(html)).toEqual(['indent']);
    const root = renderHtml(html, ctx());
    expect(root.querySelector('p')?.getAttribute('onclick')).toBeNull();
    expect(root.querySelector('p')?.getAttribute('srcdoc')).toBeNull();
    expect(root.querySelector('p')?.getAttribute('indent')).toBe('2');
    expect(root.querySelector('iframe')).toBeNull();
  });

  it('resolves ace-asset images asynchronously', async () => {
    const root = renderHtml('<img src="ace-asset:001.PNG"><img src="ace-asset:none.png">', ctx());
    await Promise.resolve();
    await Promise.resolve();
    const [ok, missing] = [...root.querySelectorAll('img')];
    expect(ok!.getAttribute('src')).toBe('blob:001');
    expect(missing!.getAttribute('src')).toBeNull();
    expect(missing!.getAttribute('data-missing')).toBe('true');
  });
});
