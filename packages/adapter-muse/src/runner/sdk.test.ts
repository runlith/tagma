import { expect, mock } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Queue } from 'effect';
import type { Frame } from './channel.js';
import { loadMuseSdk } from './sdk.js';

type Module = typeof import('@muse-code/sdk');

class MspError extends Error {
  constructor(
    readonly kind: string,
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

const fake = (version: number) => {
  let notify: (note: { method: string; params?: unknown }) => void = () => {};
  let ask: (asked: { method: string; params?: unknown }) => Promise<Record<string, unknown>> = async () => ({});
  const answers: Record<string, unknown>[] = [];
  const module = {
    MspError,
    spawnMspConnection: () => ({
      child: { stderrTail: [] },
      onNotification: (handler: typeof notify) => {
        notify = handler;
      },
      onServerRequest: (handler: typeof ask) => {
        ask = handler;
      },
      onProtocolError: () => {},
      close: async () => ({ code: 0, signal: null }),
      initialize: async () => ({
        initializeResult: {
          schema: { version },
          serverInfo: { version: '1.4.10' },
          grantedCapabilities: ['sessionMcp'],
          museHome: '/home',
        },
        child: { stderrTail: [] },
        exited: new Promise(() => {}),
        connection: {
          command: async (method: string) => {
            if (method === 'turn/steer') throw new MspError('commandRejected', -32030, 'already_terminal');
            return { status: 'accepted' };
          },
          request: async () => ({}),
          mintCommandId: () => 'minted',
        },
      }),
    }),
  } as unknown as Module;
  return {
    module,
    notify: (note: { method: string; params?: unknown }) => notify(note),
    ask: async (asked: { method: string; params?: unknown }) => answers.push(await ask(asked)),
    answers,
  };
};

const connected = (module: Module) =>
  Effect.andThen(
    Effect.sync(() => mock.module('@muse-code/sdk', () => module)),
    loadMuseSdk,
  );

const launch = (frames: Queue.Queue<Frame>) => ({
  program: 'muse',
  args: ['serve'],
  cwd: '/work',
  env: {},
  sessionMcp: true,
  frame: (frame: Frame) => Queue.offer(frames, frame).pipe(Effect.asVoid),
  stderr: () => {},
});

it.effect('a host speaking an envelope other than version 1 is refused before any session opens', () =>
  Effect.gen(function* () {
    const frames = yield* Queue.unbounded<Frame>();
    const sdk = yield* connected(fake(2).module);
    const refused = yield* Effect.flip(sdk.open(launch(frames)));
    expect(refused.message).toContain('envelope 2');
  }),
);

it.effect(
  'notifications and server requests reach the frame port in order, a request is answered at once, and a refusal keeps its kind',
  () =>
    Effect.gen(function* () {
      const frames = yield* Queue.unbounded<Frame>();
      const connection = fake(1);
      const host = yield* (yield* connected(connection.module)).open(launch(frames));
      connection.notify({ method: 'turn/started', params: { turnId: 't' } });
      yield* Effect.promise(() => connection.ask({ method: 'approval/request', params: { approvalId: 'a' } }));
      expect(yield* Queue.take(frames)).toEqual({ method: 'turn/started', params: { turnId: 't' }, request: false });
      expect(yield* Queue.take(frames)).toEqual({ method: 'approval/request', params: { approvalId: 'a' }, request: true });
      expect(connection.answers).toEqual([{}]);
      expect(yield* Effect.flip(host.command('turn/steer', {}))).toMatchObject({
        _tag: 'MuseRefused',
        kind: 'commandRejected',
        code: -32030,
      });
      expect(host.home).toBe('/home');
    }),
);
