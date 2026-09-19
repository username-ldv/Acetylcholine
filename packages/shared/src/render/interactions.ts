/**
 * Declarative stand-ins for dictionary JavaScript, which the extension never runs (MV3 forbids
 * dynamic code and the content is untrusted). Converters mark elements with
 * `data-ace-toggle="<class>"` and `data-ace-toggle-target="self|parent|<selector>"`; a click on
 * such an element toggles the class on the target, which is enough for the usual collapsible
 * notes and "show more" blocks whose CSS keys off a class.
 */

export const TOGGLE_ATTRIBUTE = 'data-ace-toggle';
export const TOGGLE_TARGET_ATTRIBUTE = 'data-ace-toggle-target';

/** The element whose class list an interaction toggles. */
export function toggleTarget(el: Element): Element | null {
  const target = el.getAttribute(TOGGLE_TARGET_ATTRIBUTE) ?? 'self';
  if (target === 'self') return el;
  if (target === 'parent') return el.parentElement;
  try {
    return el.closest(target);
  } catch {
    return null;
  }
}

/** Delegated click handler for `data-ace-toggle` elements inside a rendered container. */
export function attachInteractionHandler(root: HTMLElement): void {
  root.addEventListener('click', (event) => {
    const source = event.target as Element | null;
    const el = source?.closest?.(`[${TOGGLE_ATTRIBUTE}]`);
    if (!el || !root.contains(el)) return;
    // A lookup link inside the toggle keeps its own behaviour.
    const link = source?.closest?.('a[data-ace-lookup]');
    if (link && el.contains(link)) return;
    const classes = (el.getAttribute(TOGGLE_ATTRIBUTE) ?? '').split(/\s+/).filter(Boolean);
    const target = toggleTarget(el);
    if (classes.length === 0 || !target) return;
    event.preventDefault();
    event.stopPropagation();
    for (const cls of classes) target.classList.toggle(cls);
  });
}
