import { Context } from 'effect';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import type { TagTable } from '../wire/tags/table.js';
import type { event } from '../../store/tables.js';

export class ActState extends Context.Service<
  ActState,
  {
    readonly vocabulary: Set<number>;
    readonly tables: Map<number, TagTable>;
    readonly recorded: (typeof event.$inferSelect)[];
    unit: WriteUnit<'graph'> | null;
  }
>()('tagma/graph/ActState') {}
