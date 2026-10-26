import { Effect, Layer } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { SessionRow, WriterRegister } from '../../../platform/contract/service/writers.js';
import { NATIVE_HARNESS } from '../../../platform/contract/wire/session.js';
import { type CopiesReading, HolderCopies, HolderStandings, type HolderReading } from '../../contract/service/holders.js';
import type { HolderState } from '../../contract/wire/holders.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';

export const makeHolderStandings = () => {
  let serving: HolderReading | null = null;
  return HolderStandings.of({
    of: (threadIds) => (serving === null || threadIds.length === 0 ? Effect.succeed(new Map<string, HolderState>()) : serving(threadIds)),
    serve: (reader) => {
      serving = reader;
      return () => {
        if (serving === reader) serving = null;
      };
    },
  });
};

export const holderStandingsLayer = Layer.sync(HolderStandings, makeHolderStandings);

export const makeHolderCopies = () => {
  let serving: CopiesReading | null = null;
  return HolderCopies.of({
    of: (threadId, projectId) =>
      serving === null
        ? Effect.fail(
            new GateRefusal('copies-unreadable', 'no running thread module names the places threads work in', [
              'read the thread’s work through a running server',
            ]),
          )
        : serving(threadId, projectId),
    serve: (reader) => {
      serving = reader;
      return () => {
        if (serving === reader) serving = null;
      };
    },
  });
};

export const holderCopiesLayer = Layer.sync(HolderCopies, makeHolderCopies);

export type Holder = { readonly session: SessionRow; readonly state: HolderState | undefined };

export const holdersOf = Effect.fn('Tasks.holdersOf')(function* (
  sessions: WriterRegister['Service'],
  standings: HolderStandings['Service'],
  ids: readonly number[],
): Effect.fn.Return<ReadonlyMap<number, Holder>, StoreFailure> {
  if (ids.length === 0) return new Map();
  const rows = yield* sessions.named(ids);
  const threads = rows.flatMap((row) => (row.harness === NATIVE_HARNESS ? [row.key] : []));
  const states = yield* standings.of(threads);
  return new Map(
    rows.map((row) => [row.id, { session: row, state: row.harness === NATIVE_HARNESS ? states.get(row.key) : undefined }] as const),
  );
});
