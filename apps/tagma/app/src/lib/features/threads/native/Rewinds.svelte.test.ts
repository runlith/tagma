import { Effect, FiberSet } from 'effect';
import { expect } from 'vitest';
import { it } from '@runlith/effect-test/vitest';
import { ShownThread } from '../ShownThread.js';
import { Rewinds } from './Rewinds.svelte.js';

const beyond = {
  files: { total: 1, unavailable: null },
  graph: { acts: [], unread: [] },
  preview: { running: null, taken: [], children: [] },
};

type Copy = 'vendor' | 'record' | 'none';

const opened = Effect.fnUntraced(function* (
  points: () => Promise<unknown>,
  history: 'journal' | 'session' | 'none' = 'journal',
  copies?: { readonly whole: Copy; readonly point: Copy },
) {
  const run = yield* FiberSet.makeRuntimePromise<never>();
  const lease = { get: () => ({ chatThread: { capabilities: { history, copies } } }) };
  const shown = new ShownThread(
    1,
    () => 'thread-1',
    () => lease as never,
    () => null,
    () => null,
  );
  const chat = { session: { activeRunId: null } };
  const writes = { attempt: (work: Effect.Effect<unknown, never>) => run(Effect.exit(work)) };
  const ops = {
    preview: () => Effect.succeed(beyond),
    points: () => Effect.promise(points),
  };
  return new Rewinds(shown, chat as never, {} as never, writes as never, ops as never, {} as never);
});

it.live('a leaving rewind owner cancels the confirmation it is waiting on', () =>
  Effect.gen(function* () {
    const rewinds = yield* opened(() => Promise.resolve({ points: [], rewinds: [] }));
    const pending = rewinds.rewind('run-1', 'from');
    yield* Effect.yieldNow;
    expect(rewinds.asking).not.toBeNull();

    rewinds.dispose();

    expect(yield* Effect.promise(() => pending)).toBe(false);
    expect(rewinds.asking).toBeNull();
  }),
);

it.live(
  'the turns of a thread offer rewind by the history its transport declares: a session-held history offers it like the journal, a history with no cut at a turn or none at all offers nothing',
  () =>
    Effect.gen(function* () {
      const answer = () => Promise.resolve({ points: [{ runId: 'run-1', rewindable: true }], rewinds: [] });
      const session = yield* opened(answer, 'session', { whole: 'record', point: 'record' });
      const uncut = yield* opened(answer, 'session', { whole: 'vendor', point: 'none' });
      const none = yield* opened(answer, 'none');
      for (const rewinds of [session, uncut, none]) rewinds.watch();
      yield* Effect.yieldNow;

      expect(session.offered).toBe(true);
      expect(session.point('run-1')).toEqual({ rewindable: true });
      expect(uncut.offered).toBe(false);
      expect(uncut.point('run-1')).toBeUndefined();
      expect(none.offered).toBe(false);
      expect(none.point('run-1')).toBeUndefined();
    }),
);

it.live('a points read that finishes after the owner left publishes nothing', () =>
  Effect.gen(function* () {
    let release: (read: unknown) => void = () => undefined;
    const rewinds = yield* opened(() => new Promise((resolve) => (release = resolve)));
    rewinds.watch();
    rewinds.dispose();

    release({ points: [{ runId: 'run-1', rewindable: true }], rewinds: [] });
    yield* Effect.yieldNow;

    expect(rewinds.point('run-1')).toBeUndefined();
  }),
);
