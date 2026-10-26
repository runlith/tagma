import { Context, Effect, type Scope } from 'effect';
import { HoldCut, HoldStalled, ReentrantCall } from '@runlith/held/failures';
import { lane, type Lane } from '@runlith/held/Lane';
import { type ThreadPortFailure } from '../ThreadBorder';
import { ThreadStorageFailed } from '../persisted';

export type ThreadLanePlace = { readonly at: number };

export type ThreadLaneAdmission<A> = { readonly ran: A } | { readonly stalled: 'none' } | { readonly stalled: 'uncertain' };

export type ThreadJournalLaneFaces = {
  place(): ThreadLanePlace;
  enter<A, E>(
    threadId: string,
    place: ThreadLanePlace,
    work: Effect.Effect<A, E>,
  ): Effect.Effect<ThreadLaneAdmission<A>, E | ThreadPortFailure>;
};

let arrivals = 0;

export const writerOrderedLane: ThreadJournalLaneFaces = {
  place: () => ({ at: (arrivals += 1) }),
  enter: (_threadId, _place, work) => Effect.map(work, (ran) => ({ ran })),
};

export const ThreadJournalLane = Context.Reference<ThreadJournalLaneFaces>('@runlith/agent/ThreadJournalLane', {
  defaultValue: () => writerOrderedLane,
});

export const threadJournalLane: Effect.Effect<Lane, never, Scope.Scope> = lane({
  name: 'thread-journal',
  owner: 'threads',
  rank: 240,
  threshold: '1 second',
  ceilings: {
    step: '15 minutes',
    wait: '1 minute',
    leaves:
      'a cut transition may have committed, and a retry under its key reads its record; a cut rollout entry leaves its file as the entry found it or wrote it whole',
  },
  external: 'none',
});

export const journalLaneFaces = (journal: Lane): ThreadJournalLaneFaces => ({
  place: () => ({ at: journal.position().at }),
  enter: <A, E>(threadId: string, place: ThreadLanePlace, work: Effect.Effect<A, E>) =>
    Effect.flatMap(
      Effect.result(journal.enter(threadId, work, { lane: journal.declaration.name, at: place.at })),
      (entered): Effect.Effect<ThreadLaneAdmission<A>, E | ThreadStorageFailed> => {
        if (entered._tag === 'Success') return Effect.succeed({ ran: entered.success });
        const failure = entered.failure;
        if (failure instanceof HoldStalled) return Effect.succeed({ stalled: 'none' });
        if (failure instanceof HoldCut) return Effect.succeed({ stalled: 'uncertain' });
        if (failure instanceof ReentrantCall) return Effect.fail(new ThreadStorageFailed({ call: 'journal-lane', cause: failure }));
        return Effect.fail(failure);
      },
    ),
});
