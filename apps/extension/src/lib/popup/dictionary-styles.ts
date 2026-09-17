import { findDictionary } from '../db/dictionaries.ts';

const cache = new Map<string, Promise<string | null>>();

/** The stored `styles.css` of a dictionary (cached per page). */
export function getDictionaryStyles(id: string): Promise<string | null> {
  let p = cache.get(id);
  if (!p) {
    p = findDictionary(id).then((rec) => rec?.styles ?? null);
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

/** Forget cached stylesheets (after an import replaced a dictionary). */
export function clearDictionaryStyles(): void {
  cache.clear();
}
