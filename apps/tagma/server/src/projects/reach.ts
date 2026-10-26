import { Effect } from 'effect';
import { CurrentProject } from './contract/service/caller.js';
import { Projects } from './contract/service/registry.js';
import type { Reach, ReachAsk } from './contract/wire/reach.js';

const of = (ids: readonly number[]): Reach => ({ kind: 'projects', ids });

export const reachOf = Effect.fn('projects.reach')(function* (asked: ReachAsk | undefined) {
  if (asked === 'all') return { kind: 'all', removed: yield* (yield* Projects).removed() } satisfies Reach;
  if (asked === undefined || asked === 'current') return of([(yield* yield* CurrentProject).project.id]);
  const registry = yield* Projects;
  const ids: number[] = [];
  for (const named of asked) ids.push((yield* registry.named(named)).id);
  return of(ids);
});
