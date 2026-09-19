// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderEntryContent } from '../src/render/index.ts';

const ctx = () => ({ resolveAsset: vi.fn(async () => null), onLookup: vi.fn() });

describe('declarative interactions', () => {
  it('toggles a class on the parent when the marked element is clicked', () => {
    const root = renderEntryContent(
      [
        {
          type: 'html',
          html: '<span class="collapse"><span class="unbox"><span class="x-lb" data-ace-toggle="is-active" data-ace-toggle-target="parent">用法说明</span><span class="t-note">note</span></span></span>',
        },
      ],
      ctx(),
    );
    const label = root.querySelector<HTMLElement>('[data-ace-toggle]')!;
    const box = root.querySelector('.unbox')!;
    expect(box.classList.contains('is-active')).toBe(false);
    label.click();
    expect(box.classList.contains('is-active')).toBe(true);
    label.click();
    expect(box.classList.contains('is-active')).toBe(false);
  });

  it('supports self and closest-selector targets and leaves lookup links alone', () => {
    const c = ctx();
    const root = renderEntryContent(
      [
        {
          type: 'html',
          html:
            '<div class="box"><p><b data-ace-toggle="open" data-ace-toggle-target=".box">more</b></p>' +
            '<i data-ace-toggle="on">self</i>' +
            '<u data-ace-toggle="x"><a href="ace-lookup:句读">句读</a></u></div>',
        },
      ],
      c,
    );
    root.querySelector<HTMLElement>('b')!.click();
    expect(root.querySelector('.box')!.classList.contains('open')).toBe(true);
    root.querySelector<HTMLElement>('i')!.click();
    expect(root.querySelector('i')!.classList.contains('on')).toBe(true);
    root.querySelector<HTMLElement>('a')!.click();
    expect(c.onLookup).toHaveBeenCalledWith('句读');
    expect(root.querySelector('u')!.classList.contains('x')).toBe(false);
  });
});
