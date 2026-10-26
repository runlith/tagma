import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Clock, Effect, Fiber } from 'effect';
import { activity } from '@runlith/activity/Activity';
import { activityKind } from '@runlith/activity/fact';
import { ActivityLog } from '@runlith/activity/log';
import { MODEL_CALL } from '@runlith/activity/modelCall';
import { ActivityStore } from '@runlith/activity/store';
import { makeDoorWorld } from '../doorFixture.js';
import { asEvidenceAnswer } from '../../../threads/testing/doubles.js';

const argument = (name: string, fallback: number): number => {
  const raw = Bun.argv.find((value) => value.startsWith(`--${name}=`));
  const value = raw === undefined ? fallback : Number.parseInt(raw.slice(name.length + 3), 10);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer`);
  return value;
};

const threadCount = argument('threads', 60);
const turns = argument('turns', 4);
const attrsBytes = argument('attrs-bytes', 8 * 1024);
const TOOL = activityKind<{ readonly toolName: string; readonly detail: string }>('tool-call');

const longestHold = Effect.fnUntraced(function* <A, E, R>(work: Effect.Effect<A, E, R>) {
  const clock = yield* Clock.clockWith(Effect.succeed);
  const now = () => Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000;
  let longest = 0;
  let last = now();
  const beat = yield* Effect.forkScoped(
    Effect.gen(function* () {
      for (;;) {
        yield* Effect.sleep('1 millis');
        const at = now();
        longest = Math.max(longest, at - last);
        last = at;
      }
    }),
  );
  yield* Effect.onExit(work, () => Fiber.interrupt(beat));
  return Math.round(Math.max(longest, now() - last));
});

const request = (turn: number) =>
  new TextEncoder().encode(
    JSON.stringify({
      model: 'opus',
      system: 'You are a careful agent. '.repeat(400),
      messages: Array.from({ length: 40 + turn * 2 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `message ${index} `.repeat(50),
      })),
    }),
  );

const main = Effect.gen(function* () {
  const world = yield* makeDoorWorld();
  const projectId = yield* world.stealthProject();
  const threads: string[] = [];
  for (let index = 0; index < threadCount; index += 1) {
    const created = yield* world.call(`/api/op/create_thread?project=${projectId}`, { method: 'POST', body: {} });
    threads.push((created.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id);
  }
  const store = yield* Effect.provide(ActivityStore, yield* Effect.promise(() => world.runtime.runtime.context()));
  const since = new Date((yield* Clock.currentTimeMillis) - 24 * 60 * 60 * 1000).toISOString();
  const detail = 'd'.repeat(attrsBytes);
  const turn = (thread: string, at: number) =>
    activity(
      MODEL_CALL,
      { provider: 'subscription', model: 'opus', rung: 'high' },
      activity(TOOL, { toolName: 'read', detail }, Effect.void),
      {
        thread,
        bodies: [{ kind: 'request', encoded: request(at), contentType: 'application/json', series: true }],
        ended: () => ({ result: { usage: { inputTokens: 1_000, outputTokens: 10 } } }),
      },
    );
  const recorded = yield* longestHold(
    Effect.gen(function* () {
      for (let at = 0; at < turns; at += 1)
        yield* Effect.forEach(threads, (thread) => turn(thread, at), { discard: true }).pipe(Effect.provideService(ActivityLog, store.log));
      yield* store.settled;
    }),
  );
  const grouped = yield* longestHold(
    world.call(`/api/op/read_thread?project=${projectId}`, {
      method: 'POST',
      body: { selection: { activeSince: since }, select: 'activity', group: ['kind'], count: true, sum: ['usage.inputTokens'] },
    }),
  );
  let pages = 0;
  let rows = 0;
  const walked = yield* longestHold(
    Effect.gen(function* () {
      let cursor: string | null | undefined;
      do {
        const answered = yield* world.call(`/api/op/read_thread?project=${projectId}`, {
          method: 'POST',
          body: { selection: { activeSince: since }, select: 'activity', fields: ['kind', 'attrs'], limit: 200, cursor },
        });
        const page = (answered.body as { evidence: ReturnType<typeof asEvidenceAnswer> }).evidence;
        pages += 1;
        rows += page.rows.length;
        cursor = page.cursor;
      } while (cursor);
    }),
  );
  console.log(
    JSON.stringify({
      sample: 'one run on this machine',
      threads: threadCount,
      activities: threadCount * turns * 2,
      attrsBytes,
      pages,
      rows,
      longestHoldMs: { recorded, grouped, walked },
    }),
  );
});

BunRuntime.runMain(Effect.scoped(main));
