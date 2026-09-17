import { chineseAdapter, japaneseAdapter } from './cjk.ts';
import { englishAdapter } from './latin.ts';
import type { LanguageAdapter } from './types.ts';

export * from './cjk.ts';
export * from './latin.ts';
export * from './types.ts';

const adapters: ReadonlyMap<string, LanguageAdapter> = new Map(
  [chineseAdapter, japaneseAdapter, englishAdapter].map((a) => [a.id, a]),
);

export function listLanguageAdapters(): LanguageAdapter[] {
  return [...adapters.values()];
}

/** Returns the adapter for a language id, falling back to Chinese (the default profile language). */
export function getLanguageAdapter(id: string): LanguageAdapter {
  return adapters.get(id) ?? adapters.get(id.split('-')[0]!) ?? chineseAdapter;
}
