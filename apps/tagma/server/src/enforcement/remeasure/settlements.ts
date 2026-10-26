import { Effect } from 'effect';
import type { LandingJournal } from '../contract/service/remeasure.js';

export const landingSettlements = (journal: LandingJournal | undefined) => {
  const journaled = new Set<string>();
  const owed = new Map<string, number>();
  const acknowledge = (key: string): Effect.Effect<void> => {
    const left = (owed.get(key) ?? 0) - 1;
    if (left > 0) {
      owed.set(key, left);
      return Effect.void;
    }
    owed.delete(key);
    if (journal === undefined) return Effect.void;
    return Effect.flatMap(Effect.result(journal.remove(key)), (removed) => {
      if (removed._tag === 'Success') {
        journaled.delete(key);
        return Effect.void;
      }
      return Effect.logWarning('a re-measured landing could not be taken off its journal, so it is measured again at the next start', {
        key,
        reason: removed.failure.message,
      });
    });
  };
  const park = (key: string, reason: string): Effect.Effect<void> => {
    const left = (owed.get(key) ?? 0) - 1;
    if (left > 0) owed.set(key, left);
    else owed.delete(key);
    if (journal === undefined || left > 0) return Effect.void;
    return Effect.flatMap(Effect.result(journal.park(key, reason)), (kept) =>
      Effect.logWarning('a landing owed to re-measurement could not be measured and stays journaled for the next start', {
        key,
        reason,
        unrecorded: kept._tag === 'Success' ? undefined : kept.failure.message,
      }),
    );
  };
  return {
    has: (key: string): boolean => journaled.has(key),
    remember: (key: string): void => {
      journaled.add(key);
    },
    owes: (key: string): boolean => owed.has(key),
    owe: (key: string): void => {
      owed.set(key, (owed.get(key) ?? 0) + 1);
    },
    acknowledge,
    acknowledged: (keys: Iterable<string>): Effect.Effect<void> => Effect.forEach([...keys], acknowledge, { discard: true }),
    park,
    parked: (keys: Iterable<string>, reason: string): Effect.Effect<void> =>
      Effect.forEach([...keys], (key) => park(key, reason), { discard: true }),
  };
};
