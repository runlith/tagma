import { Effect } from 'effect';
import { doctrineOf } from '../threads/doctrine/render.js';
import type { DoctrineText } from '../platform/contract/service/sections.js';
import { FACTS, SECTIONS, collectedOperations } from './manifest.js';

export const doctrine: Effect.Effect<DoctrineText> = Effect.runSync(
  Effect.cached(
    Effect.map(collectedOperations, ({ tables }) =>
      doctrineOf(
        SECTIONS,
        FACTS,
        tables.map((table) => ({
          title: table.title,
          entries: table.declarations.map((declaration) => ({ id: declaration.id, meaning: declaration.meaning })),
        })),
      ),
    ),
  ),
);
