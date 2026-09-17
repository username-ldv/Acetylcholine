import type { Theme } from '@acetylcholine/shared';

/** Applies a theme by toggling the `dark` class on the document root. */
export function applyTheme(theme: Theme, doc: Document = document): () => void {
  const root = doc.documentElement;
  const media = doc.defaultView?.matchMedia('(prefers-color-scheme: dark)');
  const update = () => {
    const dark = theme === 'dark' || (theme === 'auto' && !!media?.matches);
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
  };
  update();
  if (theme === 'auto' && media) {
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }
  return () => {};
}
