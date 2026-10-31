import { doctrineOf } from '../threads/doctrine/render.js';
import type { DoctrineText } from '../platform/contract/service/sections.js';
import type { Assembly } from './manifest.js';

export const doctrineText = ({ sections, facts, operations }: Assembly): DoctrineText =>
  doctrineOf(
    sections,
    facts,
    operations.tables.map((table) => ({
      title: table.title,
      entries: table.declarations.map((declaration) => ({ id: declaration.id, meaning: declaration.meaning })),
    })),
  );
