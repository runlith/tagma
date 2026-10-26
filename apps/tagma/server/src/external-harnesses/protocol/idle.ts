import { Clock, Effect } from 'effect';
import { unfinished } from './endings.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { Link } from './links.js';
import type { ProtocolRow } from './row.js';

export const IDLE_MS = 60 * 60 * 1000;

export const resting = (link: Link): boolean => restingRow(link.row, link.facet);

export const restingRow = (row: ProtocolRow, facet: ExternalSession): boolean => {
  return (
    row.phase === 'ready' &&
    facet.session?.state === 'running' &&
    !unfinished(row) &&
    row.steering.length === 0 &&
    row.compact === null &&
    (row.cut === null || row.cut.request === null) &&
    row.background === 0
  );
};

export type Quiet = 'exited' | 'output' | 'released';

export const idleResource = Effect.fnUntraced(function* <E>(
  since: Effect.Effect<number, E>,
  activity: Effect.Effect<'exited' | 'output', E>,
  release: Effect.Effect<boolean, E>,
  idleMs: number,
): Effect.fn.Return<Quiet, E> {
  let retryAt = 0;
  for (;;) {
    const left = Math.max((yield* since) + idleMs, retryAt) - (yield* Clock.currentTimeMillis);
    const first = yield* Effect.raceFirst(activity, Effect.as(Effect.sleep(Math.max(left, 0)), 'idle' as const));
    if (first !== 'idle') return first;
    if (yield* release) return 'released';
    retryAt = (yield* Clock.currentTimeMillis) + idleMs;
  }
});

export const touch = (link: Link): Effect.Effect<void> =>
  Effect.map(Clock.currentTimeMillis, (now) => {
    link.activeAt = now;
  });

export const due = (link: Link, idleMs: number): Effect.Effect<boolean> =>
  Effect.map(Clock.currentTimeMillis, (now) => link.activeAt + idleMs <= now);

export const idling = Effect.fnUntraced(function* <E>(link: Link, release: Effect.Effect<boolean, E>, idleMs: number) {
  for (;;) {
    const now = yield* Clock.currentTimeMillis;
    const left = link.activeAt + idleMs - now;
    if (left > 0) {
      yield* Effect.sleep(left);
      continue;
    }
    const seen = link.activeAt;
    if (yield* release) return;
    if (link.activeAt === seen) yield* Effect.sleep(idleMs);
  }
});
