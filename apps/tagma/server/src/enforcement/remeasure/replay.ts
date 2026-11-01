import { existsSync } from 'node:fs';
import { Effect, type Result } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { JournalPosition, JournaledLanding, JournalRow, LandingJournal } from '../contract/service/remeasure.js';
import type { landingSettlements } from './settlements.js';

const JOURNAL_PAGE = 64;

export const replayLandings = Effect.fnUntraced(function* (
  journal: LandingJournal,
  held: {
    readonly settlements: ReturnType<typeof landingSettlements>;
    readonly open: (projectId: number, root: string) => Effect.Effect<boolean>;
    readonly place: (landed: JournaledLanding & { readonly journal: string }) => void;
  },
) {
  const { settlements } = held;
  let after: JournalPosition | null = null;
  for (;;) {
    const rows: Result.Result<readonly JournalRow[], StoreFailure> = yield* Effect.result(journal.page(after, JOURNAL_PAGE));
    if (rows._tag === 'Failure')
      return yield* Effect.logWarning('the landings still owed to re-measurement could not be read, so they wait for the next start', {
        reason: rows.failure.message,
      });
    for (const { key, landing } of rows.success) {
      if (settlements.has(key)) continue;
      settlements.remember(key);
      if (landing === null) {
        yield* settlements.park(key, 'its journaled payload no longer decodes');
        continue;
      }
      if (!existsSync(landing.root)) {
        yield* settlements.vacated(landing, [key]);
        continue;
      }
      if (yield* held.open(landing.projectId, landing.root)) held.place({ ...landing, journal: key });
    }
    const last = rows.success.at(-1);
    if (last === undefined || rows.success.length < JOURNAL_PAGE) return;
    after = { at: last.at, key: last.key };
  }
});
