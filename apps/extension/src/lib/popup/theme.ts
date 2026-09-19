import type { Theme } from '@acetylcholine/shared';

/**
 * Applies a theme by toggling the `dark` class and `color-scheme` on the document root, so both
 * the popup's own styles and dictionary CSS using `light-dark()` follow it. `onChange` receives
 * the resolved scheme (also when an `auto` theme follows the OS).
 */
export function applyTheme(
  theme: Theme,
  doc: Document = document,
  onChange?: (dark: boolean) => void,
): () => void {
  const root = doc.documentElement;
  const media = doc.defaultView?.matchMedia('(prefers-color-scheme: dark)');
  const update = () => {
    const dark = theme === 'dark' || (theme === 'auto' && !!media?.matches);
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
    onChange?.(dark);
  };
  update();
  if (theme === 'auto' && media) {
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }
  return () => {};
}
