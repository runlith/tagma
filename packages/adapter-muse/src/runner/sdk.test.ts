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

type Pages = (params: { readonly cursor: string }) => Promise<Record<string, unknown>>;

const fake = (version: number, pages: Pages = async () => ({ events: [], nextCursor: null })) => {
  let notify: (note: { method: string; params?: unknown }) => void = () => {};
  let ask: (asked: { method: string; params?: unknown }) => Promise<Record<string, unknown>> = async () => ({});
  let hangUp: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    hangUp = resolve;
  });
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
          request: async (method: string, params: { readonly cursor: string }) => (method === 'view/page' ? pages(params) : {}),
          mintCommandId: () => 'minted',
          closed,
        },
      }),
    }),
  } as unknown as Module;
  return {
    module,
    hangUp: () => hangUp(),
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

it.effect('a host whose MSP connection closes while its process still runs is ended', () =>
  Effect.gen(function* () {
    const frames = yield* Queue.unbounded<Frame>();
    const connection = fake(1);
    const host = yield* (yield* connected(connection.module)).open(launch(frames));
    connection.hangUp();
    expect(yield* host.ended).toContain('closed its MSP connection');
  }),
);

const event = (method: string, viewCursor: string) => ({ method, params: { sessionId: 's', viewCursor } });

it.effect('events a gap dropped are paged back in order before the events delivered after it', () =>
  Effect.gen(function* () {
    const frames = yield* Queue.unbounded<Frame>();
    const connection = fake(1, async ({ cursor }) =>
      cursor === 'c1'
        ? { events: [event('item/started', 'c2'), event('item/completed', 'c3')], nextCursor: 'c3' }
        : { events: [event('turn/completed', 'c4')], nextCursor: null },
    );
    yield* (yield* connected(connection.module)).open(launch(frames));
    connection.notify({ method: 'view/gap', params: { sessionId: 's', after: 'c1', next: 'c4' } });
    connection.notify(event('turn/completed', 'c4'));
    const seen = [];
    for (let at = 0; at < 3; at += 1) seen.push(yield* Queue.take(frames));
    expect(seen.map((frame) => [frame.method, frame.params.viewCursor])).toEqual([
      ['item/started', 'c2'],
      ['item/completed', 'c3'],
      ['turn/completed', 'c4'],
    ]);
  }),
);

it.effect('a gap Muse cannot page back ends the host rather than leaving a turn short of its events', () =>
  Effect.gen(function* () {
    const frames = yield* Queue.unbounded<Frame>();
    const connection = fake(1, async () => {
      throw new MspError('invalidParams', -32602, 'cursor expired');
    });
    const host = yield* (yield* connected(connection.module)).open(launch(frames));
    connection.notify({ method: 'view/gap', params: { sessionId: 's', after: 'c1', next: 'c4' } });
    expect(yield* host.ended).toContain('could not page them back');
  }),
);
