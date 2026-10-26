import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { addressed, distinctLength, tailOf } from '../contract/wire/references.js';

export type NameHolder = { readonly uuid: string; readonly projectId: number };

export const ambiguousAcross = Effect.fn('graph.ambiguousAcross')(function* (name: string, holders: readonly NameHolder[]) {
  const projects = yield* Projects;
  const ids = [...new Set(holders.map((one) => one.projectId))];
  const names = new Map(yield* Effect.forEach(ids, (id) => Effect.map(projects.byId(id), (row) => [id, row.name] as const)));
  const length = distinctLength(holders.map((one) => one.uuid));
  const blocks = new Set(holders.map((one) => tailOf(one.uuid, length))).size;
  const spread = ids.length > 1;
  const reason =
    blocks === 1
      ? `${name} names one block standing in ${ids.length} projects`
      : `${name} names ${blocks} blocks${spread ? ` in ${ids.length} projects` : ''}`;
  return yield* new GateRefusal('ambiguous-name', reason, [
    spread
      ? 'write the one meant by its address below — its project id, a slash, its name — in any field naming a block'
      : 'write more of the name — the tail is what tells them apart',
    ...holders.map((one) =>
      spread ? `${addressed(one.projectId, tailOf(one.uuid, length))} in ${names.get(one.projectId)}` : tailOf(one.uuid, length),
    ),
  ]);
});
