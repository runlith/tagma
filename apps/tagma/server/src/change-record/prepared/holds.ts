import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { Deferred, Effect, Exit } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { holderKey } from '../../workspace/contract/wire/checkout.js';
import { type PreparedHold, type PreparedHolds, type PreparedRow, WorkingPathUnread } from '../contract/service/prepared.js';
import type { Judged } from '../contract/service/holdings.js';
import { type Listing, listingUnder, standing } from '@runlith/files/working';
import type { Landing, Planned } from './tree.js';

const MISSING: PreparedHold = { _tag: 'missing' };

const UNHELD: PreparedHold = { _tag: 'unheld' };

const OWN: PreparedHold = { _tag: 'own' };

const GONE: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

type Failure = StoreFailure | WorkingPathUnread | GateRefusal<'walk-cut'>;

const standsAt = Effect.fnUntraced(function* (path: string, listing: Listing): Effect.fn.Return<boolean, WorkingPathUnread> {
  const stood = yield* standing(path, listing);
  if (stood === 'absent') return false;
  if (stood !== 'stands') return yield* new WorkingPathUnread({ path, reason: stood.unread });
  try {
    return !lstatSync(join(listing.root, path)).isDirectory();
  } catch (cause) {
    if (GONE.has((cause as NodeJS.ErrnoException).code ?? '')) return false;
    return yield* new WorkingPathUnread({ path, reason: String(cause) });
  }
});

export const liveHolders = (judged: Judged | undefined): readonly string[] => {
  const verdict = judged?.holding.verdict;
  if (verdict === undefined) return [];
  return verdict.verdict === 'proven'
    ? verdict.hands.filter((hand) => !hand.retired).map((hand) => holderKey(hand.holder))
    : verdict.writers.map(holderKey);
};

export const holdsOf = <Row extends PreparedRow>(landing: Landing<Row>, planned: ReadonlyMap<string, Planned<Row>>): PreparedHolds => {
  const listing = listingUnder(landing.root);
  const asked = new Map<string, Deferred.Deferred<PreparedHold, Failure>>();
  const read = Effect.fnUntraced(function* (paths: readonly string[]): Effect.fn.Return<ReadonlyMap<string, PreparedHold>, Failure> {
    const present: string[] = [];
    for (const path of paths) {
      if (planned.has(path)) continue;
      if (yield* standsAt(path, listing)) present.push(path);
    }
    const landable = present.length === 0 ? [] : yield* landing.fns.eligiblePaths(landing.git, landing.root, present);
    if (landable.length === 0) return new Map();
    const judged = yield* landing.fns.judged(landing, landable);
    return new Map(
      landable.map((path): [string, PreparedHold] => {
        const live = liveHolders(judged.get(path));
        if (live.some((one) => landing.carriers.has(one))) return [path, OWN];
        return [path, live.length === 0 ? UNHELD : { _tag: 'peers', holders: live }];
      }),
    );
  });
  return (paths) =>
    Effect.suspend(() => {
      const fresh = [...new Set(paths)].filter((path) => !asked.has(path));
      const owed = fresh.map((path) => [path, Deferred.makeUnsafe<PreparedHold, Failure>()] as const);
      for (const [path, deferred] of owed) asked.set(path, deferred);
      const filled =
        owed.length === 0
          ? Effect.void
          : Effect.asVoid(
              Effect.onExit(read(fresh), (exit) =>
                Effect.forEach(
                  owed,
                  ([path, deferred]) =>
                    Deferred.done(
                      deferred,
                      Exit.map(exit, (found) => found.get(path) ?? MISSING),
                    ),
                  { discard: true },
                ),
              ),
            );
      return Effect.andThen(
        filled,
        Effect.forEach(paths, (path) => Deferred.await(asked.get(path)!)),
      );
    });
};
