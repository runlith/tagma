import { Context, Effect } from 'effect';
import { join } from 'node:path';
import { HoldCut, HoldStalled, ReentrantCall } from '@runlith/held/failures';
import type { Lane } from '@runlith/held/Lane';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import type { GraphServices } from '../../graph/contract/service/services.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { ThreadProjection } from './projection.js';
import { ROLLOUT_SUFFIX } from './rolloutForms.js';
import type { RolloutParts } from './rolloutMeta.js';
import type { RolloutWriter } from './rolloutWriter.js';

const providing = (store: MachineStore['Service']) => Effect.provideService(MachineStore, store);

export type RolloutContext = {
  readonly records: ThreadRecords['Service'];
  readonly floor: RolloutWriter;
  readonly projection: ThreadProjection;
  readonly graph: Context.Context<GraphServices | MachineStore>;
  readonly parts: RolloutParts;
  readonly kinds: ThreadEntryReader;
  readonly home: string | undefined;
  readonly machineStore: ReturnType<typeof providing>;
  readonly pathOf: (projectId: number, threadId: string) => string | undefined;
  readonly inJournal: <A, E>(threadId: string, work: Effect.Effect<A, E>) => Effect.Effect<A, E | GateRefusal | ThreadStorageFailed>;
};

export type JournalEntry = RolloutContext['inJournal'];

export const journalEntry =
  (journal: Lane): JournalEntry =>
  <A, E>(threadId: string, work: Effect.Effect<A, E>): Effect.Effect<A, E | GateRefusal | ThreadStorageFailed> =>
    Effect.mapError(journal.enter(threadId, work), (failure): E | GateRefusal | ThreadStorageFailed => {
      if (failure instanceof HoldStalled) {
        return new GateRefusal(
          'journal-busy',
          `Thread ${threadId}'s journal stayed busy for ${Math.round(failure.waitedMs / 1000)} s, so this rollout step did not start.`,
          ['try again once the thread is quiet; nothing was changed'],
        );
      }
      if (failure instanceof HoldCut) {
        return new GateRefusal('journal-cut', `Thread ${threadId}'s rollout step ran past its ceiling and was cut: ${failure.leaves}.`, [
          'read what this rollout disagrees about before running the step again',
        ]);
      }
      if (failure instanceof ReentrantCall) return new ThreadStorageFailed({ call: 'journal-lane', cause: failure });
      return failure;
    });

export const rolloutContext = (input: {
  readonly records: ThreadRecords['Service'];
  readonly floor: RolloutWriter;
  readonly projection: ThreadProjection;
  readonly graph: Context.Context<GraphServices | MachineStore>;
  readonly parts: RolloutParts;
  readonly kinds: ThreadEntryReader;
  readonly journal: Lane;
  readonly home: string | undefined;
}): RolloutContext => {
  const { journal, home } = input;
  return {
    records: input.records,
    floor: input.floor,
    projection: input.projection,
    graph: input.graph,
    parts: input.parts,
    kinds: input.kinds,
    home,
    machineStore: providing(Context.get(input.graph, MachineStore)),
    pathOf: (projectId, threadId) => (home === undefined ? undefined : join(home, String(projectId), `${threadId}${ROLLOUT_SUFFIX}`)),
    inJournal: journalEntry(journal),
  };
};
