import { z } from 'zod';
import { ACE_FORMAT_VERSION } from './types.ts';

// Loose structured-content validation: we care about shape, not every style enum.
export const structuredContentSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.array(structuredContentSchema),
    z
      .object({
        tag: z.string(),
        content: structuredContentSchema.optional(),
        data: z.record(z.string(), z.string()).optional(),
        href: z.string().optional(),
        path: z.string().optional(),
      })
      .loose(),
  ]),
);

export const aceContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('structured'), content: structuredContentSchema }),
  z.object({ type: z.literal('html'), html: z.string() }),
  z.object({ type: z.literal('image'), path: z.string() }).loose(),
  z.object({ type: z.literal('deinflection'), term: z.string(), rules: z.array(z.string()) }),
]);

export const aceReadingSchema = z.object({
  text: z.string().min(1),
  tags: z.array(z.string()),
});

export const aceEntrySchema = z.object({
  id: z.number().int().nonnegative(),
  headwords: z.array(z.string().min(1)).min(1),
  readings: z.array(aceReadingSchema),
  content: z.array(aceContentSchema),
  tags: z.array(z.string()),
  termTags: z.array(z.string()),
  rules: z.array(z.string()),
  score: z.number(),
  sequence: z.number().int(),
});

export const aceKeySchema = z.tuple([
  z.string().min(1),
  z.number().int().nonnegative(),
  z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
]);

export const aceTagSchema = z.tuple([z.string(), z.string(), z.number(), z.string(), z.number()]);

export const aceMetaSchema = z.tuple([z.string(), z.enum(['freq', 'pitch', 'ipa']), z.unknown()]);

export const aceKanjiSchema = z.tuple([
  z.string().min(1),
  z.string(),
  z.string(),
  z.string(),
  z.array(z.string()),
  z.record(z.string(), z.string()),
]);

export const aceKanjiMetaSchema = z.tuple([z.string().min(1), z.literal('freq'), z.unknown()]);

export const aceCountsSchema = z.object({
  entries: z.number().int().nonnegative(),
  keys: z.number().int().nonnegative(),
  meta: z.number().int().nonnegative(),
  tags: z.number().int().nonnegative(),
  kanji: z.number().int().nonnegative(),
  kanjiMeta: z.number().int().nonnegative(),
  assets: z.number().int().nonnegative(),
});

export const aceFilesSchema = z.object({
  entries: z.array(z.string()),
  keys: z.array(z.string()),
  meta: z.array(z.string()),
  kanji: z.array(z.string()),
  kanjiMeta: z.array(z.string()),
  assets: z.array(z.string()),
  styles: z.string().optional(),
  tags: z.string().optional(),
});

export const aceManifestSchema = z
  .object({
    aceVersion: z.literal(ACE_FORMAT_VERSION),
    id: z.string().min(1),
    title: z.string().min(1),
    revision: z.string(),
    author: z.string().optional(),
    description: z.string().optional(),
    attribution: z.string().optional(),
    url: z.string().optional(),
    sourceLanguage: z.string().optional(),
    targetLanguage: z.string().optional(),
    readingTags: z.array(z.string()),
    source: z.object({ format: z.string() }).loose(),
    generator: z.string(),
    createdAt: z.string(),
    sequenced: z.boolean().optional(),
    frequencyMode: z.enum(['occurrence-based', 'rank-based']).optional(),
    contentKinds: z.array(z.enum(['text', 'structured', 'html', 'image', 'deinflection'])),
    counts: aceCountsSchema,
    files: aceFilesSchema,
  })
  .loose();

export type AceManifestParsed = z.infer<typeof aceManifestSchema>;
