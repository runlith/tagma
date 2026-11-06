import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect, Queue, Stream } from 'effect';
import { ConnectionError, SqlError } from 'effect/sql/SqlError';
import { TestClock } from 'effect/testing';
import type { SettingKey } from '../platform/contract/wire/setting.js';
import { Settings } from '../settings/contract/service/values.js';
import {
  Exposure,
  type ExposureStep,
  ListenerRefused,
  type PointAsk,
  type SiteKeeping,
  WithdrawalRefused,
} from './contract/service/exposure.js';
import { remoteEnabled } from './keys.js';
import { makeReach } from './reach.js';
import { Ledger } from './store/ledger.js';
import { unreadLedger } from './testing/doubles.js';

const ORIGIN = 'https://tagma-test.tail0000.ts.net';

const PORT = 5710;

const listener = { port: PORT, open: Effect.void, close: Effect.void };

const unused = () => Effect.die('the door reads only remote.enabled');

const readied = (): Stream.Stream<ExposureStep> =>
  Stream.make<ExposureStep[]>(
    { _tag: 'setting-up' },
    { _tag: 'certificate', origin: ORIGIN },
    { _tag: 'listening', sandbox: { _tag: 'off' } },
    { _tag: 'ready', origin: ORIGIN, sandbox: { _tag: 'off' }, machine: null },
  );

type Door = {
  readonly switches: Queue.Queue<boolean>;
  readonly expose?: Exposure['Service']['expose'];
  readonly point?: Exposure['Service']['point'];
  readonly withdraw?: Exposure['Service']['withdraw'];
  readonly ledger?: Ledger['Service'];
};

const door = (given: Door) =>
  Context.make(
    Settings,
    Settings.of({
      read: unused,
      value: unused,
      chain: unused,
      live: unused,
      held: unused,
      changes: <A>(key: SettingKey<A>) =>
        key.id === remoteEnabled.id ? Effect.succeed(Stream.map(Stream.fromQueue(given.switches), (on) => on as A)) : unused(),
      write: unused,
      amend: unused,
    }),
  ).pipe(
    Context.add(Ledger, given.ledger ?? Ledger.of({ ...unreadLedger, origin: Effect.succeed(ORIGIN), terminal: Effect.succeed(null) })),
    Context.add(
      Exposure,
      Exposure.of({
        expose: given.expose ?? (() => Stream.never),
        point: given.point ?? (() => Effect.die('this door points no terminal site')),
        withdraw: given.withdraw ?? (() => Effect.void),
      }),
    ),
  );

it.effect('switching access off withdraws the mapping of the settled origin again after each refusal', () =>
  Effect.gen(function* () {
    const switches = yield* Queue.unbounded<boolean>();
    const withdrawals = yield* Queue.unbounded<number>();
    let refusals = 2;
    const withdraw = Effect.fnUntraced(function* (port: number) {
      yield* Queue.offer(withdrawals, port);
      if (refusals === 0) return;
      refusals -= 1;
      return yield* new WithdrawalRefused({ reason: 'the tailscale daemon is busy' });
    });
    const reach = yield* Effect.provide(makeReach, door({ switches, withdraw }));
    yield* Effect.forkScoped(reach.serve(listener));
    yield* Queue.offer(switches, false);
    expect(yield* Queue.take(withdrawals)).toBe(PORT);
    yield* TestClock.adjust('2 seconds');
    expect(yield* Queue.take(withdrawals)).toBe(PORT);
    yield* TestClock.adjust('4 seconds');
    expect(yield* Queue.take(withdrawals)).toBe(PORT);
  }),
);

it.effect('switching access back on interrupts a withdrawal still in flight', () =>
  Effect.gen(function* () {
    const switches = yield* Queue.unbounded<boolean>();
    const withdrawing = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const exposed = yield* Deferred.make<void>();
    const reach = yield* Effect.provide(
      makeReach,
      door({
        switches,
        withdraw: () =>
          Deferred.succeed(withdrawing, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          ),
        expose: () => Stream.unwrap(Effect.as(Deferred.succeed(exposed, undefined), Stream.never)),
      }),
    );
    yield* Effect.forkScoped(reach.serve(listener));
    yield* Queue.offer(switches, false);
    yield* Deferred.await(withdrawing);
    yield* Queue.offer(switches, true);
    yield* Deferred.await(exposed);
    expect(yield* Deferred.isDone(interrupted)).toBe(true);
  }),
);

it.effect('a listener that cannot open leaves the door blocked with its reason', () =>
  Effect.gen(function* () {
    const switches = yield* Queue.unbounded<boolean>();
    const reach = yield* Effect.provide(makeReach, door({ switches, expose: readied }));
    const refused = { ...listener, open: Effect.fail(new ListenerRefused({ reason: 'port 5710 is taken' })) };
    yield* Effect.forkScoped(reach.serve(refused));
    yield* Queue.offer(switches, true);
    yield* Effect.repeat(reach.read, { until: (read) => read.state._tag === 'blocked' });
    expect((yield* reach.read).state).toEqual({
      _tag: 'blocked',
      problem: 'listener-failed',
      detail: 'port 5710 is taken',
      command: null,
      link: null,
    });
  }),
);

it.effect('the terminal endpoint gets an HTTPS site of its own, follows the endpoint’s port on it, and is withdrawn with access', () =>
  Effect.gen(function* () {
    const switches = yield* Queue.unbounded<boolean>();
    const exposed = yield* Deferred.make<void>();
    const withdrawals = yield* Queue.unbounded<readonly [number, readonly number[]]>();
    const kept: { port: number | null } = { port: null };
    const asks: PointAsk[] = [];
    const ledger = Ledger.of({
      ...unreadLedger,
      origin: Effect.succeed(ORIGIN),
      terminal: Effect.sync(() => kept.port),
      keepTerminal: (port) =>
        Effect.sync(() => {
          kept.port = port;
        }),
    });
    const point: Exposure['Service']['point'] = Effect.fnUntraced(function* (asked: PointAsk, keep: SiteKeeping) {
      asks.push(asked);
      const port = asked.port ?? 12_001;
      if (port !== asked.port) yield* Effect.orDie(keep(port));
      return { port, state: { _tag: 'ready', origin: `${ORIGIN}:${port}` } as const };
    });
    const reach = yield* Effect.provide(
      makeReach,
      door({
        switches,
        ledger,
        point,
        expose: () => Stream.concat(readied(), Stream.drain(Stream.fromEffect(Deferred.succeed(exposed, undefined)))),
        withdraw: (port, pointed) => Effect.asVoid(Queue.offer(withdrawals, [port, pointed] as const)),
      }),
    );
    yield* Effect.forkScoped(reach.serve(listener));
    expect(yield* Effect.flip(reach.terminal.origin(5801))).toMatchObject({ _tag: 'blocked' });
    yield* Queue.offer(switches, true);
    yield* Deferred.await(exposed);

    expect(yield* reach.terminal.origin(5801)).toBe(`${ORIGIN}:12001`);
    expect(yield* reach.terminal.origin(5801)).toBe(`${ORIGIN}:12001`);
    expect(yield* reach.terminal.origin(5802)).toBe(`${ORIGIN}:12001`);
    expect(asks.map(({ port, target }) => [port, target])).toEqual([
      [null, 5801],
      [12_001, 5802],
    ]);
    expect(kept.port).toBe(12_001);

    yield* Queue.offer(switches, false);
    expect(yield* Queue.take(withdrawals)).toEqual([PORT, [12_001]]);
    expect(yield* Effect.flip(reach.terminal.origin(5802))).toMatchObject({ _tag: 'blocked' });
  }),
);

it.effect('a terminal site whose port cannot be read is blocked with the store’s reason while the door stays ready', () =>
  Effect.gen(function* () {
    const switches = yield* Queue.unbounded<boolean>();
    const exposed = yield* Deferred.make<void>();
    const down = new SqlError({ reason: new ConnectionError({ cause: new Error('down'), message: 'the machine store is down' }) });
    const ledger = Ledger.of({ ...unreadLedger, origin: Effect.succeed(ORIGIN), terminal: Effect.fail(down) });
    const reach = yield* Effect.provide(
      makeReach,
      door({
        switches,
        ledger,
        expose: () => Stream.concat(readied(), Stream.drain(Stream.fromEffect(Deferred.succeed(exposed, undefined)))),
      }),
    );
    yield* Effect.forkScoped(reach.serve(listener));
    yield* Queue.offer(switches, true);
    yield* Deferred.await(exposed);
    expect(yield* Effect.flip(reach.terminal.origin(5801))).toEqual({
      _tag: 'blocked',
      problem: 'refused',
      detail: 'the port of the terminal site could not be read: the machine store is down',
      command: null,
      link: null,
    });
    expect((yield* reach.read).state).toEqual({ _tag: 'ready', origin: ORIGIN });
  }),
);
