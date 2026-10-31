import { Context, Effect, type Scope } from 'effect';
import { HoldCut, HoldStalled, ReentrantCall } from '@runlith/held/failures';
import { lane, type Lane } from '@runlith/held/Lane';
import { Holding, liveHolds, liveTickets, Origin } from '@runlith/held/holding';
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
  order<A, E>(threadId: string, work: Effect.Effect<A, E>): Effect.Effect<A, E | ThreadPortFailure>;
};

let arrivals = 0;

export const writerOrderedLane: ThreadJournalLaneFaces = {
  place: () => ({ at: (arrivals += 1) }),
  enter: (_threadId, _place, work) => Effect.map(work, (ran) => ({ ran })),
  order: (_threadId, work) => work,
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

export const ordering =
  (name: string, place: ThreadJournalLaneFaces['place'], enter: ThreadJournalLaneFaces['enter']): ThreadJournalLaneFaces['order'] =>
  <A, E>(threadId: string, work: Effect.Effect<A, E>) =>
    Effect.flatMap(Effect.all([Holding, Origin]), ([holding, origin]): Effect.Effect<A, E | ThreadPortFailure> => {
      const identity = `${name}:${threadId}`;
      if (origin.has(identity) || holding.within.includes(identity) || liveHolds(holding).length > 0 || liveTickets(holding).length > 0)
        return work;
      return Effect.flatMap(enter(threadId, place(), work), (admitted): Effect.Effect<A, E | ThreadPortFailure> => {
        if ('ran' in admitted) return Effect.succeed(admitted.ran);
        if (admitted.stalled === 'none') return work;
        return Effect.fail(
          new ThreadStorageFailed({ call: 'journal-order', cause: new Error(`the journal lane of ${threadId} cut a step`) }),
        );
      });
    });

export const journalLaneFaces = (journal: Lane): ThreadJournalLaneFaces => {
  const place = () => ({ at: journal.position().at });
  const enter = <A, E>(threadId: string, held: ThreadLanePlace, work: Effect.Effect<A, E>) =>
    Effect.flatMap(Effect.all([Holding, Origin]), ([holding, origin]) =>
      origin.has(`${journal.declaration.name}:${threadId}`) || holding.within.includes(`${journal.declaration.name}:${threadId}`)
        ? Effect.map(work, (ran): ThreadLaneAdmission<A> => ({ ran }))
        : admitted(threadId, held, work),
    );
  const admitted = <A, E>(threadId: string, held: ThreadLanePlace, work: Effect.Effect<A, E>) =>
    Effect.flatMap(
      Effect.result(journal.enter(threadId, work, { lane: journal.declaration.name, at: held.at })),
      (entered): Effect.Effect<ThreadLaneAdmission<A>, E | ThreadStorageFailed> => {
        if (entered._tag === 'Success') return Effect.succeed({ ran: entered.success });
        const failure = entered.failure;
        if (failure instanceof HoldStalled) return Effect.succeed({ stalled: 'none' });
        if (failure instanceof HoldCut) return Effect.succeed({ stalled: 'uncertain' });
        if (failure instanceof ReentrantCall) return Effect.fail(new ThreadStorageFailed({ call: 'journal-lane', cause: failure }));
        return Effect.fail(failure);
      },
    );
  return { place, enter, order: ordering(journal.declaration.name, place, enter) };
};
