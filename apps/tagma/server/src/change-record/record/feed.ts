import { Effect, Stream } from 'effect';
import { refusing } from '../../platform/contract/service/body.js';
import { GateRefusal, type RefusalBody } from '../../platform/contract/wire/refusal.js';
import type { HoldingsFrame } from '../contract/wire/holdings.js';
import type { ThreadChangesFrame } from '../contract/wire/threadChanges.js';
import { CHANGE_COMMITS } from '../contract/wire/threadChanges.js';
import type { Holdings, HoldingsFailure } from '../contract/service/holdings.js';
import type { ThreadChanges } from '../contract/service/threadChanges.js';
import type { ThreadRoots } from '../contract/service/threadRoots.js';
import type { CheckoutPlaces } from '../../workspace/contract/service/checkouts.js';
import { rootReadRefusal } from '../../workspace/roots/refusal.js';
import type { OutcomeUnread } from '../contract/service/record.js';
import { outcomeRefusal } from './outcomes.js';

const refusalOf = (failure: HoldingsFailure | OutcomeUnread): GateRefusal<string> => {
  switch (failure._tag) {
    case 'OutcomeUnread':
      return outcomeRefusal(failure);
    case 'RootMissing':
    case 'RootUnavailable':
    case 'RootInvalid':
    case 'RootRefused':
    case 'RootConflict':
      return rootReadRefusal(failure);
    default:
      return new GateRefusal('record-unread', `the change record could not be read: ${failure.message}`, [
        'subscribe again once the store answers',
      ]);
  }
};

const refused = <A>(stream: Stream.Stream<A, HoldingsFailure | OutcomeUnread>): Stream.Stream<A, RefusalBody> =>
  Stream.catch(stream, (failure) => Stream.fromEffect(refusing(Effect.fail(refusalOf(failure)))));

export const changesChannel = (
  checkouts: CheckoutPlaces['Service'],
  holdings: Holdings['Service'],
  changes: ThreadChanges['Service'],
  roots: ThreadRoots['Service'],
) => ({
  'holdings.subscribe': ({
    projectId,
    root,
  }: {
    readonly projectId: number;
    readonly root?: string;
  }): Stream.Stream<HoldingsFrame, RefusalBody> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const rootId = yield* refusing(checkouts.rootOf({ projectId, cwd: undefined }, root));
        return refused(holdings.subscribe(rootId));
      }),
    ),
  'thread.changes': ({
    projectId,
    threadId,
    commits,
  }: {
    readonly projectId: number;
    readonly threadId: string;
    readonly commits?: number;
  }): Stream.Stream<ThreadChangesFrame, RefusalBody> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const placed = yield* refusing(roots.rootOf(threadId));
        const home = yield* refusing(checkouts.rootOf({ projectId, cwd: undefined }, placed ?? undefined));
        return refused(changes.subscribe(projectId, threadId, home, commits ?? CHANGE_COMMITS));
      }),
    ),
});
