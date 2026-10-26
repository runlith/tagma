import type { ActivityFaults } from '@runlith/activity/store/faults';
import { Effect, Stream } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { FaultsFrame } from './contract/wire/faults.js';

type Unreadable = Effect.Error<ReturnType<ActivityFaults['Service']['read']>>;

export const unreadable = (failure: Unreadable): GateRefusal<'activity-unreadable'> =>
  new GateRefusal('activity-unreadable', `the activity store could not be read: ${failure.reason}`, [
    'read again; a store that stays unreadable is named in the server log',
  ]);

export const faultsFeed = (faults: ActivityFaults['Service'], limit: number): Stream.Stream<FaultsFrame> =>
  Stream.succeed(undefined).pipe(
    Stream.concat(Stream.never),
    Stream.merge(faults.changes),
    Stream.buffer({ capacity: 1, strategy: 'sliding' }),
    Stream.mapEffect(() =>
      Effect.match(faults.read({ limit }), {
        onSuccess: (page): FaultsFrame => ({ type: 'page', faults: page.faults, total: page.total, since: page.since, lost: page.lost }),
        onFailure: (failure): FaultsFrame => ({ type: 'unreadable', reason: failure.reason }),
      }),
    ),
  );
