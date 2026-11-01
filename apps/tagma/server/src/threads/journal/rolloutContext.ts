import { Context, Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { join } from 'node:path';
import { HoldCut, HoldStalled, ReentrantCall } from '@runlith/held/failures';
import type { Lane } from '@runlith/held/Lane';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import type { GraphServices } from '../../graph/contract/service/services.js';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { recordFacts } from '../../thread-record/facts.js';
import { journalProjectOf } from '../store/journal.js';
import type { ThreadProjection } from './projection.js';
import { ROLLOUT_SUFFIX } from './rolloutForms.js';
import type { RolloutParts } from './rolloutMeta.js';
import type { RolloutWriter } from './rolloutWriter.js';
import type { SourceRetention } from './sourceRetention.js';
import type { SourcePublication } from './sourceFiles.js';
import type { SourceReplacement } from './sourceReplacement.js';

const providing = (store: MachineStore['Service']) => Effect.provideService(MachineStore, store);

export type RolloutContext = {
  readonly records: ThreadRecords['Service'];
  readonly floor: RolloutWriter;
  readonly retention: SourceRetention;
  readonly publication: SourcePublication;
  readonly replacement: SourceReplacement;
  readonly projection: ThreadProjection;
  readonly graph: Context.Context<GraphServices | MachineStore>;
  readonly parts: RolloutParts;
  readonly kinds: ThreadEntryReader;
  readonly home: string | undefined;
  readonly machineStore: ReturnType<typeof providing>;
  readonly pathOf: (projectId: number, threadId: string) => string | undefined;
  readonly journalOf: (threadId: string) => Effect.Effect<number | undefined, StoreFailure>;
  readonly locate: (threadId: string) => Effect.Effect<string | undefined, StoreFailure>;
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
  readonly retention: SourceRetention;
  readonly publication: SourcePublication;
  readonly replacement: SourceReplacement;
  readonly projection: ThreadProjection;
  readonly graph: Context.Context<GraphServices | MachineStore>;
  readonly parts: RolloutParts;
  readonly kinds: ThreadEntryReader;
  readonly journal: Lane;
  readonly home: string | undefined;
}): RolloutContext => {
  const { journal, home } = input;
  const store = Context.get(input.graph, MachineStore);
  const pathOf = (projectId: number, threadId: string) =>
    home === undefined ? undefined : join(home, String(projectId), `${threadId}${ROLLOUT_SUFFIX}`);
  const journalOf = (threadId: string) =>
    Effect.map(
      store.db
        .select({ journal: journalProjectOf(recordFacts.id, recordFacts.projectId) })
        .from(recordFacts)
        .where(eq(recordFacts.id, threadId))
        .get(),
      (row) => row?.journal ?? undefined,
    );
  const locate = (threadId: string) =>
    Effect.map(journalOf(threadId), (journal) => (journal === undefined ? undefined : pathOf(journal, threadId)));
  const enter = journalEntry(journal);
  const inJournal: JournalEntry = (threadId, work) =>
    enter(
      threadId,
      Effect.gen(function* () {
        if (!input.replacement.pending(threadId)) return yield* work;
        const path = yield* locate(threadId).pipe(Effect.mapError((cause) => new ThreadStorageFailed({ call: 'source.recover', cause })));
        if (path === undefined)
          return yield* new ThreadStorageFailed({
            call: 'source.recover',
            cause: new Error(`The journal place of ${threadId} is unavailable.`),
          });
        yield* input.replacement
          .settle(threadId, path)
          .pipe(Effect.mapError((cause) => new ThreadStorageFailed({ call: 'source.recover', cause })));
        return yield* work;
      }),
    );
  return {
    records: input.records,
    floor: input.floor,
    retention: input.retention,
    publication: input.publication,
    replacement: input.replacement,
    projection: input.projection,
    graph: input.graph,
    parts: input.parts,
    kinds: input.kinds,
    home,
    machineStore: providing(store),
    pathOf,
    journalOf,
    locate,
    inJournal,
  };
};
