// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  primaryReadingTagFor,
  readingTagVisibilityCss,
  renderEntryContent,
  renderHtml,
  renderStructured,
  selectReadings,
} from '../src/render/index.ts';

const ctx = () => ({
  resolveAsset: vi.fn(async (path: string) => (path === 'img/a.png' ? 'blob:a' : null)),
  onLookup: vi.fn(),
});

describe('structured content renderer', () => {
  it('maps tags, data attributes, styles and lang', () => {
    const c = ctx();
    const node = renderStructured(
      {
        tag: 'div',
        data: { guifan: 'dt', readingTag: 'pinyin' },
        style: { fontWeight: 'bold', marginLeft: 1.5, textDecorationLine: ['underline'] },
        lang: 'zh-CN',
        content: ['a', { tag: 'span', content: 'b' }, { tag: 'br' }],
      },
      c,
    ) as HTMLElement;
    expect(node.tagName).toBe('DIV');
    expect(node.getAttribute('data-sc-guifan')).toBe('dt');
    expect(node.getAttribute('data-sc-reading-tag')).toBe('pinyin');
    expect(node.style.fontWeight).toBe('bold');
    expect(node.style.marginLeft).toBe('1.5em');
    expect(node.style.textDecorationLine).toBe('underline');
    expect(node.lang).toBe('zh-CN');
    expect(node.childNodes).toHaveLength(3);
    expect(node.childNodes[2]!.nodeName).toBe('BR');
  });

  it('turns ?query= links into lookup links and keeps http links external', () => {
    const c = ctx();
    const root = renderEntryContent(
      [
        {
          type: 'structured',
          content: [
            { tag: 'a', href: '?query=%E5%8F%A5&wildcards=off', content: '句' },
            { tag: 'a', href: 'https://example.com/x', content: 'ext' },
          ],
        },
      ],
      c,
    );
    const [internal, external] = [...root.querySelectorAll('a')];
    expect(internal!.getAttribute('data-ace-lookup')).toBe('句');
    expect(external!.target).toBe('_blank');
    internal!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(c.onLookup).toHaveBeenCalledWith('句');
  });

  it('renders images with the gloss-image markup and resolves assets asynchronously', async () => {
    const c = ctx();
    const link = renderStructured(
      { tag: 'img', path: 'img/a.png', width: 2, sizeUnits: 'em', background: false },
      c,
    ) as HTMLElement;
    expect(link.classList.contains('gloss-image-link')).toBe(true);
    expect(link.getAttribute('data-background')).toBe('false');
    expect(link.style.width).toBe('2em');
    const img = link.querySelector('img')!;
    await Promise.resolve();
    await Promise.resolve();
    expect(img.getAttribute('src')).toBe('blob:a');
    const missing = renderStructured({ tag: 'img', path: 'nope.png' }, c) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    expect(missing.getAttribute('data-missing')).toBe('true');
  });

  it('renders text, image and deinflection blocks', () => {
    const root = renderEntryContent(
      [
        { type: 'text', text: 'plain\ntext' },
        { type: 'image', path: 'img/a.png' },
        { type: 'deinflection', term: '読む', rules: ['v5'] },
      ],
      ctx(),
    );
    expect(root.querySelector('.ace-text')!.textContent).toBe('plain\ntext');
    expect(root.querySelector('.gloss-image-link')).not.toBeNull();
    expect(root.querySelector('.ace-deinflection a')!.getAttribute('data-ace-lookup')).toBe('読む');
  });
});

describe('html renderer', () => {
  it('keeps custom elements, strips scripts and handlers, rewrites ace links', async () => {
    const c = ctx();
    const root = renderHtml(
      '<entry><hw onclick="x()">读</hw><script>alert(1)</script><x-pr>dú</x-pr>' +
        '<a href="ace-lookup:%E5%8F%A5">句</a><img src="ace-asset:img/a.png"><a href="javascript:evil()">j</a></entry>',
      c,
    );
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('hw')!.getAttribute('onclick')).toBeNull();
    expect(root.querySelector('x-pr')!.textContent).toBe('dú');
    expect(root.querySelector('a[data-ace-lookup]')!.getAttribute('data-ace-lookup')).toBe('句');
    expect(root.querySelectorAll('a')[1]!.getAttribute('href')).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    expect(root.querySelector('img')!.getAttribute('src')).toBe('blob:a');
  });
});

describe('readings', () => {
  it('selects the primary reading system by preference', () => {
    const readings = [
      { text: 'dú', tags: ['pinyin'] },
      { text: 'ㄉㄨˊ', tags: ['zhuyin'] },
    ];
    expect(selectReadings(readings, ['zhuyin', 'pinyin'])).toEqual({
      primaryTag: 'zhuyin',
      primary: [readings[1]],
      secondary: [readings[0]],
    });
    expect(selectReadings(readings, []).primaryTag).toBe('pinyin');
    expect(selectReadings([], ['pinyin']).primary).toEqual([]);
    const equivalent = [
      { text: 'shéi', tags: ['pinyin'] },
      { text: 'shuí', tags: ['pinyin'] },
    ];
    expect(selectReadings(equivalent, ['pinyin']).primary).toHaveLength(2);
  });

  it('builds reading-tag visibility css', () => {
    expect(primaryReadingTagFor(['pinyin', 'zhuyin'], ['zhuyin'])).toBe('zhuyin');
    expect(primaryReadingTagFor(['pinyin'], ['zhuyin'])).toBe('pinyin');
    expect(primaryReadingTagFor([], ['zhuyin'])).toBeNull();
    expect(readingTagVisibilityCss(null)).toBe('');
    expect(readingTagVisibilityCss('zhuyin')).toContain('[data-sc-reading-tag="zhuyin"]');
  });
});
