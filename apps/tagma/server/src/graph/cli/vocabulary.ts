import { Effect } from 'effect';
import type { DoorLens, Perform } from '../../platform/contract/service/perform.js';
import { CurrentInvocation, type Invocation } from '../../platform/cli/verb.js';
import { OUTLINE_OPERATIONS } from '../contract/wire/operations/outline.js';
import type { TagReading } from '../contract/wire/tags/reading.js';
import { ServedTags } from '../contract/wire/tags/served.js';

export const vocabularyOf = (perform: Perform) => {
  const held = new WeakMap<Invocation, Map<string, TagReading>>();
  return (query: DoorLens): Effect.Effect<TagReading, unknown> =>
    Effect.flatMap(CurrentInvocation, (at) => {
      const tables = held.get(at) ?? new Map<string, TagReading>();
      held.set(at, tables);
      const key = `${query.project ?? `cwd:${query.cwd ?? at.cwd}`}${query.scope === undefined ? '' : `#${query.scope}`}`;
      const standing = tables.get(key);
      if (standing !== undefined) return Effect.succeed(standing);
      return perform(OUTLINE_OPERATIONS.read_vocabulary, {}, query).pipe(
        Effect.map((answer) => {
          const table = new ServedTags(answer);
          tables.set(key, table);
          return table;
        }),
      );
    });
};
