import { expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SafeStorageKey } from '@runlith/browser-cookies/source';
import { layer } from '@runlith/effect-test';
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Queue, Stream } from 'effect';
import { RpcClient, RpcGroup } from 'effect/rpc';
import * as Socket from 'effect/socket/Socket';
import { Automation } from '../browser/contract/service/automation.js';
import { Hosts } from '../browser/contract/service/hosts.js';
import { Pages } from '../browser/contract/service/pages.js';
import type { PageId } from '../browser/contract/wire/ids.js';
import { browserWorld, Seeded } from '../browser/testing/world.js';
import { liveSerialization, rpcOf } from '../platform/contract/wire/live.js';
import { TAGMA_SOCKET_PATH } from '../socket/rpc.js';
import { desktopAdapter } from './adapter.js';
import { ATTACH_FEED, type Call, DESKTOP, framed, type Order, PART_CHARS, REPORT_PATH, type Report } from './contract/wire/channel.js';
import { ServedChannel, servedChannel } from './testing/served.js';

const HOST = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
const group = RpcGroup.make(rpcOf(ATTACH_FEED));
const home = mkdtempSync(join(tmpdir(), 'desktop-channel-'));

type Called = { readonly id: number; readonly call: Call };

const wsAt = (url: URL, path: string): URL => {
  const at = new URL(path, url);
  at.protocol = 'ws:';
  return at;
};

const fakeHost = Effect.fnUntraced(function* (url: URL) {
  const protocol = yield* Layer.build(
    RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Socket.layerWebSocket(wsAt(url, TAGMA_SOCKET_PATH).toString())),
      Layer.provide([liveSerialization, Socket.layerWebSocketConstructorGlobal]),
    ),
  );
  const client = yield* Effect.provide(RpcClient.make(group), protocol);
  const orders = yield* Queue.unbounded<Order>();
  yield* client.attach_browser_host({ host: HOST, pid: process.pid }).pipe(
    Stream.runForEach((order) => Queue.offer(orders, order)),
    Effect.forkScoped,
  );
  const first = yield* Queue.take(orders);
  if (first.kind !== 'attached') return yield* Effect.die(`the feed opened with ${first.kind}`);
  const reports = wsAt(url, REPORT_PATH);
  reports.searchParams.set('host', HOST);
  reports.searchParams.set('generation', String(first.generation));
  const socket = yield* Effect.acquireRelease(
    Effect.callback<WebSocket>((resume) => {
      const opened = new WebSocket(reports);
      opened.addEventListener('open', () => resume(Effect.succeed(opened)));
      opened.addEventListener('error', () => resume(Effect.die('the report socket did not open')));
    }),
    (open) => Effect.sync(() => open.close()),
  );
  let seq = 0;
  const next = () => ++seq;
  const sent = (report: Report, tail?: string) => framed(report, tail).forEach((part) => socket.send(part));
  const called = Effect.gen(function* () {
    for (;;) {
      const order = yield* Queue.take(orders);
      if (order.kind === 'call') return { id: order.id, call: order.call } satisfies Called;
    }
  });
  const answer = (id: number, value: unknown = null) => sent({ kind: 'answer', seq: next(), id, value });
  return { generation: first.generation, called, answer, sent, next, close: () => socket.close() };
});

const built = Layer.build(servedChannel);

const served = Effect.map(built, (context) => Context.get(context, ServedChannel).url);

const standing = Effect.gen(function* () {
  const hosts = yield* Hosts;
  for (let host = hosts.connected(DESKTOP); ; host = hosts.connected(DESKTOP)) {
    if (host !== undefined) return host;
    yield* Effect.sleep('1 millis');
  }
});

const operator = Effect.map(Seeded, (seeded) => ({ projectId: seeded.id, thread: null, human: true }));

layer(browserWorld({ host: Layer.empty, adapters: [desktopAdapter], home }), { excludeTestServices: true })('the desktop channel', (it) => {
  it.effect(
    'registers the host after its report stream opens, answers calls, and applies reports strictly by seq, a parted one whole',
    () =>
      Effect.gen(function* () {
        const pages = yield* Pages;
        const fake = yield* fakeHost(yield* served);
        const live = yield* fake.called;
        expect(live.call.kind).toBe('live');
        fake.answer(live.id, []);
        const host = yield* standing;
        expect(host.pid).toBe(process.pid);

        const opening = yield* Effect.forkChild(pages.open(yield* operator, { url: 'https://example.com/', profile: undefined }));
        for (let call = yield* fake.called; ; call = yield* fake.called) {
          fake.answer(call.id, call.call.kind === 'open' ? { restricted: false, revision: 0 } : null);
          if (call.call.kind === 'open') break;
        }
        const page = (yield* Fiber.join(opening)).id;
        expect(pages.live(page)?.loading).toBe(true);

        const heard = yield* Queue.unbounded<string | undefined>();
        const events = yield* host.pages.events;
        yield* Effect.forkScoped(
          Stream.runForEach(events, (event) => (event.kind === 'changed' ? Queue.offer(heard, event.change.title) : Effect.void)),
        );
        const going = yield* Effect.forkChild(host.pages.navigate(page, { kind: 'url', url: 'https://example.com/next' }));
        const navigate = yield* fake.called;
        const answerSeq = fake.next();
        const firstEventSeq = fake.next();
        fake.sent({ kind: 'event', seq: fake.next(), event: { kind: 'changed', page, change: { title: 'Last' } } });
        fake.sent({ kind: 'event', seq: firstEventSeq, event: { kind: 'changed', page, change: { title: 'Next' } } });
        const title = `${'a'.repeat(PART_CHARS - 1)}😀`;
        fake.sent({ kind: 'answer', seq: answerSeq, id: navigate.id, value: { url: 'https://example.com/next', title, loading: true } });
        expect(yield* Fiber.join(going)).toEqual({ url: 'https://example.com/next', title, loading: true });
        expect([yield* Queue.take(heard), yield* Queue.take(heard)]).toEqual(['Next', 'Last']);
      }),
  );

  it.effect('the Keychain key of a browser is read by the connected desktop and refused as away without one', () =>
    Effect.gen(function* () {
      const context = yield* built;
      const key = Context.get(context, SafeStorageKey);
      const away = yield* Effect.flip(key.read('Chrome Safe Storage', 'Chrome'));
      expect(away.reason).toBe('away');
      const fake = yield* fakeHost(Context.get(context, ServedChannel).url);
      const live = yield* fake.called;
      fake.answer(live.id, []);
      yield* standing;
      const reading = yield* Effect.forkChild(key.read('Chrome Safe Storage', 'Chrome'));
      const asked = yield* fake.called;
      expect(asked.call).toEqual({ kind: 'key', service: 'Chrome Safe Storage', account: 'Chrome' });
      fake.answer(asked.id, 'synthetic-key');
      expect(yield* Fiber.join(reading)).toBe('synthetic-key');
    }),
  );

  it.effect('a window declaration reaches the port under its host and generation, and the declaration ends with the generation', () =>
    Effect.gen(function* () {
      const { url, windows } = Context.get(yield* built, ServedChannel);
      const fake = yield* fakeHost(url);
      const live = yield* fake.called;
      fake.answer(live.id, []);
      yield* standing;
      const declaration = {
        precisionMs: 10,
        processes: [
          {
            pid: 4242,
            createdMs: 1_700_000_000_000,
            kind: 'renderer' as const,
            documents: [{ _tag: 'Origin' as const, origin: 'https://example.test' }],
          },
        ],
      };
      fake.sent({ kind: 'declaration', seq: fake.next(), declaration });
      expect(yield* Queue.take(windows)).toEqual({ kind: 'declare', host: HOST, generation: fake.generation, declaration });
      fake.close();
      expect(yield* Queue.take(windows)).toEqual({ kind: 'end', host: HOST, generation: fake.generation });
    }),
  );

  it.effect(
    'a lost host leaves its call outcome-unknown and its pages away, is waited for while its process lives, and is reconciled on return',
    () =>
      Effect.gen(function* () {
        const hosts = yield* Hosts;
        const pages = yield* Pages;
        const automation = yield* Automation;
        const url = yield* served;
        const first = yield* fakeHost(url);
        const live = yield* first.called;
        first.answer(live.id, []);
        yield* standing;
        const opening = yield* Effect.forkChild(pages.open(yield* operator, { url: 'https://example.com/kept', profile: undefined }));
        for (let call = yield* first.called; ; call = yield* first.called) {
          first.answer(call.id, call.call.kind === 'open' ? { restricted: false, revision: 0 } : null);
          if (call.call.kind === 'open') break;
        }
        const page: PageId = (yield* Fiber.join(opening)).id;

        const going = yield* Effect.forkChild(automation.navigate(page, { kind: 'url', url: 'https://example.com/elsewhere' }, null));
        expect((yield* first.called).call.kind).toBe('navigate');
        first.close();
        const lost = yield* Fiber.await(going);
        const refused = Exit.isFailure(lost) ? Cause.findErrorOption(lost.cause) : Option.none();
        expect(Option.isSome(refused) && refused.value._tag === 'GateRefusal' ? refused.value.code : null).toBe('outcome-unknown');
        const away = yield* pages.list((yield* Seeded).id, { closed: false, limit: 10, after: null });
        expect(away.pages.find((held) => held.id === page)?.state).toBe('away');

        const reached = yield* Deferred.make<string>();
        const reaching = yield* Effect.forkChild(Effect.flatMap(hosts.reach(DESKTOP), (host) => Deferred.succeed(reached, host.id)));
        yield* Effect.yieldNow;
        expect(reaching.pollUnsafe()).toBeUndefined();

        const second = yield* fakeHost(url);
        expect(second.generation).toBeGreaterThan(first.generation);
        const reconcile = yield* second.called;
        expect(reconcile.call.kind).toBe('live');
        second.answer(reconcile.id, [
          {
            page,
            local: 'page-1',
            profile: 'user',
            url: 'https://example.com/kept#back',
            title: 'Kept',
            opener: null,
            restriction: { restricted: false, revision: 0 },
          },
        ]);
        expect(yield* Deferred.await(reached)).toBe(HOST);
        for (;;) {
          const listed = yield* pages.list((yield* Seeded).id, { closed: false, limit: 10, after: null });
          const held = listed.pages.find((one) => one.id === page);
          if (held?.state === 'live' && held.url === 'https://example.com/kept#back') break;
          yield* Effect.sleep('5 millis');
        }
      }),
  );
});
