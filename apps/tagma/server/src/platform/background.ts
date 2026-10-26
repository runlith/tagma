import { Clock, Effect } from 'effect';
import { Background, type BackgroundDeclaration } from './contract/service/background.js';
import type { BackgroundWork } from './contract/wire/background.js';

const SHOWN_AFTER_MS = 3_000;
const PACE_MS = 60_000;

type Pace = { readonly at: number; readonly done: number };

type Running = Omit<BackgroundDeclaration, 'reason'> & {
  reason: string;
  readonly id: string;
  readonly startedAt: number;
  done: number;
  readonly paces: Pace[];
};

const remaining = (one: Running): number | null => {
  const first = one.paces[0];
  const last = one.paces.at(-1);
  if (one.total === null || first === undefined || last === undefined || last.at <= first.at) return null;
  const rate = (last.done - first.done) / (last.at - first.at);
  return rate > 0 ? Math.max(0, one.total - one.done) / rate : null;
};

export const makeBackground = Effect.sync(() => {
  const running = new Map<string, Running>();

  const advanced = (one: Running, count: number) =>
    Effect.map(Clock.currentTimeMillis, (at) => {
      one.done += count;
      one.paces.push({ at, done: one.done });
      while (one.paces.length > 2 && one.paces[0]!.at < at - PACE_MS) one.paces.shift();
    });

  return Background.of({
    run: (declared, work) =>
      Effect.acquireUseRelease(
        Effect.map(Clock.currentTimeMillis, (at) => {
          const one: Running = { ...declared, id: crypto.randomUUID(), startedAt: at, done: 0, paces: [{ at, done: 0 }] };
          running.set(one.id, one);
          return one;
        }),
        (one) =>
          work({
            stage: (reason) =>
              Effect.sync(() => {
                one.reason = reason;
              }),
            advance: (count = 1) => advanced(one, count),
          }),
        (one) => Effect.sync(() => running.delete(one.id)),
      ),
    standing: Effect.map(Clock.currentTimeMillis, (now) =>
      [...running.values()].flatMap((one): BackgroundWork[] =>
        now - one.startedAt < SHOWN_AFTER_MS
          ? []
          : [
              {
                id: one.id,
                title: one.title,
                reason: one.reason,
                done: one.done,
                total: one.total,
                startedAt: one.startedAt,
                remainingMs: remaining(one),
              },
            ],
      ),
    ),
  });
});
