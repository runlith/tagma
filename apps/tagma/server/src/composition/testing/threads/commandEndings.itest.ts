import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Context, Deferred, Duration, Effect, Fiber, Layer, Option, Queue, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { ByteOffset, type ByteCursor } from '@runlith/executions/protocol/record';
import { Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import { type NativeExit, ExecutionId, HostRequestKey, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { TargetKey } from '../../../executions/contract/wire/targets.js';
import { TerminalUnavailable } from '../../../executions/contract/wire/refusals.js';
import { commandSignalId } from '../../../executions/contract/wire/commands.js';
import type { CommandReading } from '../../../executions/contract/wire/commands.js';
import { type CommandOutputRequest, CommandReader, CommandWaiters } from '../../../executions/contract/service/commands.js';
import { commandOutputReader } from '../../../executions/testing/doubles.js';
import { waitersOver } from '../../../executions/testing/waitersFixture.js';
import { executionHandshakeMs } from '../../../executions/contract/wire/terminalBehavior.js';
import type { TerminalWaitAnswer } from '../../../executions/contract/wire/terminals.js';
import { ExecutionRecords } from '../../../executions/contract/service/records.js';
import { ManagedCommands } from '../../../executions/contract/service/commands.js';
import { Terminals } from '../../../executions/contract/service/terminals.js';
import { commandDelivery, asCommandSignalOutcome, asCommandSignalSend } from '../../../threads/testing/doubles.js';
import { storesOver } from '../../../executions/testing/stores.js';

const INSTALLATION = InstallationId.make('command-delivery');
const holder = ThreadId.make('thread-command-delivery');

const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.orDie(Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, {}, pool)))),
  ),
);
const setup = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const store = storesOver(db, INSTALLATION);
  const handedBack = yield* Queue.unbounded<ExecutionRef>();
  const waiters = yield* waitersOver(store.deliveries, handedBack);
  return { db, units, store, handedBack, waiters };
});
class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/CommandEndingsWorld') {}

layer(Layer.effect(World, setup).pipe(Layer.provideMerge(storage)))('command endings', (it) => {
  const execution = (id: string): ExecutionRef => ({ installation: INSTALLATION, execution: ExecutionId.make(id), incarnation: 1 });

  const owe = Effect.fn('testing.oweCommandEnding')(function* (ref: ExecutionRef, toolCall: string, openedAt?: number) {
    const { units, store } = yield* World;
    const at = openedAt ?? (yield* Clock.currentTimeMillis);
    yield* units.write('CommandDelivery.owe', (unit) =>
      store.deliveries.openDelivery(unit, {
        execution: ref,
        thread: holder,
        signalId: commandSignalId(ref, toolCall),
        openedAt: at,
      }),
    );
  });

  const emptyBytes = (cursor: ByteCursor) =>
    Effect.succeed({
      range: { cursor, next: cursor.offset, retainedFrom: ByteOffset.make('0'), durableThrough: ByteOffset.make('0'), gap: false },
      bytes: new Uint8Array(0),
    });

  const commandsLayer = Layer.mock(ManagedCommands, { record: () => Effect.succeed(null), changes: () => Stream.empty });
  const recordsLayer = Layer.mock(ExecutionRecords, { bytes: emptyBytes, records: () => Stream.empty });

  const decided = (ref: ExecutionRef, exit: NativeExit): ExecutionSummary => ({
    state: {
      ref,
      transport: 'pipes',
      lifetime: 'command',
      purpose: 'command',
      phase: 'ended',
      streams: { stdout: 'eof', stderr: 'eof', pty: 'eof' },
      record: 'available',
      cleanup: 'complete',
      nativeExit: exit,
    },
    custody: {
      revision: 0,
      holder: Principal.make(`thread:${holder}`),
      origin: Principal.make(`thread:${holder}`),
      target: { environment: 'host', namespace: 'machine', cwd: '/repo', dependencies: [] },
    },
    streams: [],
    native: {},
    input: { acceptedThrough: ByteOffset.make('0'), pendingBytes: 0 },
    decision: {
      _tag: 'Completed',
      operation: { installation: INSTALLATION, operation: HostRequestKey.make('op-1') },
      execution: ref,
      sequence: 0,
    },
  });

  type SentEnding = Parameters<ReturnType<typeof asCommandSignalSend>>[0];
  type DeliveryRoad = {
    readonly delivery: Effect.Success<ReturnType<typeof commandDelivery>>;
    readonly sent: () => readonly SentEnding[];
    readonly landed: () => readonly SentEnding[];
  };
  const deliveryOver = Effect.fn('testing.commandEndingDelivery')(function* (
    answer: () => TerminalWaitAnswer,
    reply: (attempt: number) => ReturnType<typeof asCommandSignalOutcome>,
    meanwhile: Effect.Effect<unknown, never, World> = Effect.void,
    commands: Layer.Layer<ManagedCommands> = commandsLayer,
  ): Effect.fn.Return<DeliveryRoad, never, World> {
    const world = yield* World;
    const { units, waiters } = world;
    const sent: SentEnding[] = [];
    const landed: SentEnding[] = [];
    const delivery = yield* commandDelivery({
      send: Effect.fn('testing.sendCommandEnding')(function* (input) {
        sent.push(input);
        const outcome = reply(sent.length);
        if (outcome._tag !== 'Accepted') return outcome;
        yield* Effect.provideService(meanwhile, World, world);
        const condition = input.condition;
        if (condition !== undefined && !(yield* Effect.orDie(units.write('CommandDelivery.delivery', (unit) => condition(unit)))))
          return { _tag: 'Declined' } as const;
        landed.push(input);
        return outcome;
      }),
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(CommandWaiters, waiters),
          Layer.mock(Terminals, { wait: () => Effect.succeed(answer()) }),
          commands,
          recordsLayer,
        ),
      ),
    );
    return { delivery, sent: () => sent, landed: () => landed };
  });

  const TURNS = 10_000;
  const untilSent = Effect.fn('testing.commandEndingSent')(function* (road: DeliveryRoad, count: number) {
    for (let turn = 0; turn < TURNS; turn++) {
      if (road.sent().length >= count) return;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(new Error(`the delivery road sent ${road.sent().length} of the ${count} this case waits for`));
  });

  const SETTLE_TURNS = 100;
  const untilSettled = Effect.fn('testing.commandEndingSettled')(function* (ref: ExecutionRef) {
    const { waiters } = yield* World;
    for (let turn = 0; turn < SETTLE_TURNS; turn++) {
      if ((yield* Effect.orDie(waiters.owed(ref))) === null) return;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(new Error(`${ref.execution} is still owed after this case waited ${SETTLE_TURNS} turns for it`));
  });

  const accepted = () => ({ _tag: 'Accepted' }) as const;

  it.effect('an ending owed is delivered once under its derived identity, and the obligation ends with it', () =>
    Effect.gen(function* () {
      const { waiters } = yield* World;
      const ref = execution('exec-delivered');
      yield* owe(ref, 'call-1');
      const road = yield* deliveryOver(() => ({ _tag: 'Decided', summary: decided(ref, { _tag: 'Code', code: 0 }) }), accepted);

      yield* road.delivery.deliver(ref);
      expect(road.landed()).toHaveLength(1);
      expect(road.landed()[0]?.id).toBe(`command:exec-delivered:1:call-1`);
      expect(road.landed()[0]?.threadId).toBe(holder);
      expect(road.landed()[0]?.notice).toEqual({
        kind: 'command-ending',
        execution: ref.execution,
        incarnation: ref.incarnation,
        command: null,
        ending: 'completed',
        exit: { kind: 'code', code: 0 },
        tail: '',
      });

      expect(yield* waiters.owed(ref).pipe(Effect.orDie)).toBeNull();
      yield* road.delivery.deliver(ref);
      expect(road.sent()).toHaveLength(1);
    }),
  );

  it.effect('an expired command delivers its command line and native signal as a structured ending', () =>
    Effect.gen(function* () {
      const ref = execution('exec-life');
      yield* owe(ref, 'call-life');
      const killed: ExecutionSummary = {
        ...decided(ref, { _tag: 'Signal', signal: 'SIGKILL' }),
        decision: {
          _tag: 'Cancelled',
          operation: { installation: INSTALLATION, operation: HostRequestKey.make('op-1') },
          execution: ref,
          sequence: 0,
          cause: 'timeout',
          trigger: 'deadline',
        },
      };
      const commands = Layer.mock(ManagedCommands, {
        record: () =>
          Effect.succeed({
            projectId: 1,
            execution: ref,
            owner: { _tag: 'Thread', thread: holder },
            origin: { _tag: 'Thread', thread: holder },
            policyIdentity: 'p',
            targetKey: TargetKey.make('k'),
            holdings: {},
            admittedAt: 0,
            commandLine: 'sleep 7200',
          }),
        deadline: () => Effect.succeed({ execution: ref, revision: 1, executionMs: 120_000, origin: 'caller' }),
        changes: () => Stream.empty,
      });
      const road = yield* deliveryOver(() => ({ _tag: 'Decided', summary: killed }), accepted, Effect.void, commands);
      yield* road.delivery.deliver(ref);
      expect(road.landed()[0]?.notice).toEqual({
        kind: 'command-ending',
        execution: ref.execution,
        incarnation: ref.incarnation,
        command: 'sleep 7200',
        ending: 'expired',
        exit: { kind: 'signal', signal: 'SIGKILL' },
        tail: '',
      });
    }),
  );

  it.effect('a timeout whose life cannot be read is still told as expired', () =>
    Effect.gen(function* () {
      const ref = execution('exec-life-unread');
      yield* owe(ref, 'call-life-unread');
      const killed: ExecutionSummary = {
        ...decided(ref, { _tag: 'Signal', signal: 'SIGKILL' }),
        decision: {
          _tag: 'Cancelled',
          operation: { installation: INSTALLATION, operation: HostRequestKey.make('op-2') },
          execution: ref,
          sequence: 0,
          cause: 'timeout',
          trigger: 'deadline',
        },
      };
      const commands = Layer.mock(ManagedCommands, {
        record: () => Effect.succeed(null),
        deadline: () => Effect.succeed(null),
        changes: () => Stream.empty,
      });
      const road = yield* deliveryOver(() => ({ _tag: 'Decided', summary: killed }), accepted, Effect.void, commands);
      yield* road.delivery.deliver(ref);
      expect(road.landed()[0]?.notice).toMatchObject({ kind: 'command-ending', ending: 'expired' });
    }),
  );

  it.effect('an unreadable ending delivers an unknown outcome without inventing an exit or output', () =>
    Effect.gen(function* () {
      const ref = execution('exec-unreadable');
      yield* owe(ref, 'call-unreadable');
      const road = yield* deliveryOver(() => ({ _tag: 'Unwatchable' }), accepted);
      yield* road.delivery.deliver(ref);
      expect(road.landed()[0]?.notice).toEqual({
        kind: 'command-ending',
        execution: ref.execution,
        incarnation: ref.incarnation,
        command: null,
        ending: 'unknown',
        exit: null,
        tail: null,
      });
    }),
  );

  it.effect('a send nobody could reach keeps the obligation, and the retry delivers it', () =>
    Effect.gen(function* () {
      const { waiters } = yield* World;
      const ref = execution('exec-unreachable');
      yield* owe(ref, 'call-2');
      const road = yield* deliveryOver(
        () => ({ _tag: 'Decided', summary: decided(ref, { _tag: 'Code', code: 3 }) }),
        (attempt) => (attempt === 1 ? { _tag: 'Unreachable', reason: 'the thread host did not answer' } : { _tag: 'Accepted' }),
      );

      expect(yield* road.delivery.deliver(ref)).toEqual({ _tag: 'Kept', retryable: true });
      expect(yield* waiters.owed(ref).pipe(Effect.orDie)).not.toBeNull();

      expect(yield* road.delivery.deliver(ref)).toEqual({ _tag: 'Settled' });
      expect(road.landed()).toHaveLength(1);
      expect(yield* waiters.owed(ref).pipe(Effect.orDie)).toBeNull();
    }),
  );

  it.effect('an ending owed to a thread that is gone ends without being delivered anywhere', () =>
    Effect.gen(function* () {
      const { waiters } = yield* World;
      const ref = execution('exec-no-thread');
      yield* owe(ref, 'call-3');
      const road = yield* deliveryOver(
        () => ({ _tag: 'Decided', summary: decided(ref, { _tag: 'Code', code: 0 }) }),
        () => ({ _tag: 'NoThread' }),
      );

      yield* road.delivery.deliver(ref);
      expect(road.sent()).toHaveLength(1);
      expect(yield* waiters.owed(ref).pipe(Effect.orDie)).toBeNull();
    }),
  );

  it.effect('a command that has not ended is told to nobody, and keeps both its obligation and its silence', () =>
    Effect.gen(function* () {
      const { waiters } = yield* World;
      const ref = execution('exec-running');
      yield* owe(ref, 'call-4');
      const road = yield* deliveryOver(() => ({ _tag: 'Undecided' }), accepted);

      yield* road.delivery.deliver(ref);
      expect(road.sent()).toHaveLength(0);
      const standing = yield* waiters.owed(ref).pipe(Effect.orDie);
      expect(standing?.text).toBeUndefined();
    }),
  );

  it.effect('an ending the thread host refuses for good ends with its reason, instead of standing for every boot', () =>
    Effect.gen(function* () {
      const { waiters } = yield* World;
      const ref = execution('exec-refused');
      yield* owe(ref, 'call-7');
      const road = yield* deliveryOver(
        () => ({ _tag: 'Decided', summary: decided(ref, { _tag: 'Code', code: 0 }) }),
        () => ({ _tag: 'Refused', reason: 'that delivery id already stands with other words' }),
      );

      yield* road.delivery.deliver(ref);
      expect(road.sent()).toHaveLength(1);
      expect(yield* waiters.owed(ref).pipe(Effect.orDie)).toBeNull();
    }),
  );

  it.effect('a discharge drives an unreachable send again itself, instead of leaving it for the next boot', () =>
    Effect.gen(function* () {
      const { waiters } = yield* World;
      const ref = execution('exec-redriven');
      yield* owe(ref, 'call-8');
      const road = yield* deliveryOver(
        () => ({ _tag: 'Decided', summary: decided(ref, { _tag: 'Code', code: 0 }) }),
        (attempt) => (attempt === 1 ? { _tag: 'Unreachable', reason: 'the thread host did not answer' } : { _tag: 'Accepted' }),
      );

      yield* Effect.gen(function* () {
        const attending = yield* Effect.forkChild(road.delivery.attend());
        yield* waiters.due(ref);
        yield* untilSent(road, 1);
        yield* TestClock.adjust(Duration.millis(executionHandshakeMs));
        yield* untilSent(road, 2);
        yield* untilSettled(ref);
        yield* Fiber.interrupt(attending);
      });
      expect(road.sent()).toHaveLength(2);
      expect(yield* waiters.owed(ref).pipe(Effect.orDie)).toBeNull();
    }),
  );

  const endedReading = (ref: ExecutionRef): CommandReading => ({
    command: {
      projectId: 1,
      execution: ref,
      owner: { _tag: 'Thread', thread: holder },
      origin: { _tag: 'Thread', thread: holder },
      policyIdentity: 'p',
      admittedAt: 0,
    },
    live: {
      _tag: 'Held',
      readAt: 0,
      entry: {
        state: decided(ref, { _tag: 'Code', code: 0 }).state,
        admission: { origin: { scope: 'project', owner: `thread:${holder}`, cohort: 'commands' }, limits: {}, policyIdentity: 'p' },
        deadline: { execution: ref, revision: 0, origin: 'default', elapsedMs: 1_000 },
        admittedAtMs: 0,
      },
    },
  });

  const unreadAuthority: CommandOutputRequest['authority'] = {
    get prepared(): never {
      throw new Error('the command output fixture does not authorize reads');
    },
    recheck: () => Effect.die('the command output fixture never rechecks authority'),
  };
  const ownerRead = Effect.fn('testing.readCommandEnding')(function* (
    ref: ExecutionRef,
    commandBytes: ManagedCommands['Service']['bytes'] = emptyBytes,
  ) {
    const { waiters } = yield* World;
    return yield* Effect.gen(function* () {
      const commands = yield* ManagedCommands;
      const reader = yield* CommandReader;
      return yield* commandOutputReader({ commands, reader, waiters }).output({
        projectId: 1,
        reader: holder,
        thread: holder,
        execution: ref,
        authority: unreadAuthority,
      });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(ManagedCommands, { bytes: commandBytes, changes: () => Stream.empty }),
          Layer.mock(CommandReader, { one: () => Effect.succeed(endedReading(ref)), follow: () => Stream.empty }),
        ),
      ),
    );
  });

  it.effect('an ending its owning thread is reading when the delivery comes to send it is not sent', () =>
    Effect.gen(function* () {
      const { waiters } = yield* World;
      const ref = execution('exec-read-while-delivering');
      yield* owe(ref, 'call-9');
      const road = yield* deliveryOver(() => ({ _tag: 'Decided', summary: decided(ref, { _tag: 'Code', code: 0 }) }), accepted);

      const { answer, attempt } = yield* Effect.gen(function* () {
        const reading = yield* Deferred.make<void>();
        const readOn = yield* Deferred.make<void>();
        const read = yield* Effect.forkChild(
          ownerRead(ref, (cursor) =>
            Deferred.succeed(reading, undefined).pipe(Effect.andThen(Deferred.await(readOn)), Effect.andThen(emptyBytes(cursor))),
          ),
        );
        yield* Deferred.await(reading);
        const attempt = yield* road.delivery.deliver(ref);
        yield* Deferred.succeed(readOn, undefined);
        return { answer: yield* Fiber.join(read), attempt };
      });

      expect(attempt).toEqual({ _tag: 'Settled' });
      expect(road.landed()).toHaveLength(0);
      expect(answer.phase).toBe('ended');
      expect(yield* waiters.owed(ref).pipe(Effect.orDie)).toBeNull();
    }),
  );

  it.effect('a notice whose acceptance comes after the owning thread read the ending is declined', () =>
    Effect.gen(function* () {
      const { waiters } = yield* World;
      const ref = execution('exec-read-while-sending');
      yield* owe(ref, 'call-10');
      const answers: string[] = [];
      const road = yield* deliveryOver(
        () => ({ _tag: 'Decided', summary: decided(ref, { _tag: 'Code', code: 0 }) }),
        accepted,
        Effect.orDie(ownerRead(ref)).pipe(Effect.map((answer) => answers.push(answer.phase))),
      );

      expect(yield* road.delivery.deliver(ref)).toEqual({ _tag: 'Settled' });
      expect(answers).toEqual(['ended']);
      expect(road.sent()).toHaveLength(1);
      expect(road.landed()).toHaveLength(0);
      expect(yield* waiters.owed(ref).pipe(Effect.orDie)).toBeNull();
    }),
  );

  it.effect('a read that fails after taking its ending hands the ending back to its notice', () =>
    Effect.gen(function* () {
      const { handedBack } = yield* World;
      const ref = execution('exec-read-failed');
      yield* owe(ref, 'call-12');
      const failed = yield* Effect.flip(
        ownerRead(ref, () => Effect.fail(new TerminalUnavailable({ owner: 'host', message: 'the record could not be read' }))),
      );
      expect(failed._tag).toBe('TerminalUnavailable');
      expect(Option.getOrUndefined(yield* Queue.poll(handedBack))).toEqual(ref);

      const road = yield* deliveryOver(() => ({ _tag: 'Decided', summary: decided(ref, { _tag: 'Code', code: 0 }) }), accepted);
      expect(yield* road.delivery.deliver(ref)).toEqual({ _tag: 'Settled' });
      expect(road.landed()).toHaveLength(1);
    }),
  );

  it.effect('an ending two reads of its thread hold is handed back only when neither answered it', () =>
    Effect.gen(function* () {
      const { waiters, handedBack } = yield* World;
      const ref = execution('exec-read-twice');
      yield* owe(ref, 'call-13');
      const road = yield* deliveryOver(() => ({ _tag: 'Decided', summary: decided(ref, { _tag: 'Code', code: 0 }) }), accepted);

      const { attempt, handed, answer } = yield* Effect.gen(function* () {
        const gate =
          (reading: Deferred.Deferred<void>, on: Deferred.Deferred<void>, then: ManagedCommands['Service']['bytes']) =>
          (...args: Parameters<ManagedCommands['Service']['bytes']>) =>
            Deferred.succeed(reading, undefined).pipe(Effect.andThen(Deferred.await(on)), Effect.andThen(then(...args)));
        const failing = { reading: yield* Deferred.make<void>(), on: yield* Deferred.make<void>() };
        const answering = { reading: yield* Deferred.make<void>(), on: yield* Deferred.make<void>() };
        const lost = yield* Effect.forkChild(
          Effect.flip(
            ownerRead(
              ref,
              gate(failing.reading, failing.on, () =>
                Effect.fail(new TerminalUnavailable({ owner: 'host', message: 'the record could not be read' })),
              ),
            ),
          ),
        );
        yield* Deferred.await(failing.reading);
        const kept = yield* Effect.forkChild(ownerRead(ref, gate(answering.reading, answering.on, emptyBytes)));
        yield* Deferred.await(answering.reading);
        yield* Deferred.succeed(failing.on, undefined);
        yield* Fiber.join(lost);
        const handed = yield* Queue.poll(handedBack);
        const attempt = yield* road.delivery.deliver(ref);
        yield* Deferred.succeed(answering.on, undefined);
        return { attempt, handed, answer: yield* Fiber.join(kept) };
      });

      expect(Option.isNone(handed)).toBe(true);
      expect(attempt).toEqual({ _tag: 'Settled' });
      expect(road.landed()).toHaveLength(0);
      expect(answer.phase).toBe('ended');
      expect(yield* waiters.owed(ref).pipe(Effect.orDie)).toBeNull();
    }),
  );

  it.effect('an ending two failed reads of its thread held is handed back once, by the last of them', () =>
    Effect.gen(function* () {
      const { waiters, handedBack } = yield* World;
      const ref = execution('exec-read-twice-failed');
      yield* owe(ref, 'call-14');
      const unreadable = () => Effect.fail(new TerminalUnavailable({ owner: 'host', message: 'the record could not be read' }));

      const handed = yield* Effect.gen(function* () {
        const first = { reading: yield* Deferred.make<void>(), on: yield* Deferred.make<void>() };
        const gated = () =>
          Deferred.succeed(first.reading, undefined).pipe(Effect.andThen(Deferred.await(first.on)), Effect.andThen(unreadable()));
        const earlier = yield* Effect.forkChild(Effect.flip(ownerRead(ref, gated)));
        yield* Deferred.await(first.reading);
        yield* Effect.flip(ownerRead(ref, unreadable));
        const afterSecond = yield* Queue.poll(handedBack);
        yield* Deferred.succeed(first.on, undefined);
        yield* Fiber.join(earlier);
        return { afterSecond, afterFirst: yield* Queue.poll(handedBack), after: yield* Queue.poll(handedBack) };
      });

      expect(Option.isNone(handed.afterSecond)).toBe(true);
      expect(Option.getOrUndefined(handed.afterFirst)).toEqual(ref);
      expect(Option.isNone(handed.after)).toBe(true);
      expect(yield* waiters.owed(ref).pipe(Effect.orDie)).not.toBeNull();
    }),
  );

  it.effect('a boot hands back an ending a read of the run before it left taken', () =>
    Effect.gen(function* () {
      const { waiters } = yield* World;
      const ref = execution('exec-taken-at-boot');
      yield* owe(ref, 'call-11');
      expect(yield* waiters.take(ref, holder).pipe(Effect.orDie)).toBe(true);
      const road = yield* deliveryOver(() => ({ _tag: 'Decided', summary: decided(ref, { _tag: 'Code', code: 0 }) }), accepted);

      expect(yield* road.delivery.deliver(ref)).toEqual({ _tag: 'Settled' });
      expect(road.landed()).toHaveLength(0);

      yield* waiters.recover().pipe(Effect.orDie);
      expect(yield* road.delivery.deliver(ref)).toEqual({ _tag: 'Settled' });
      expect(road.landed()).toHaveLength(1);
    }),
  );

  it.effect('a restart reads back every ending still owed and delivers each one', () =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const ownUnits = yield* MachineUnits;
        const ownStore = storesOver((yield* MachineStore).db, INSTALLATION);
        const ownWaiters = yield* waitersOver(ownStore.deliveries);
        const first = execution('exec-resumed-a');
        const second = execution('exec-resumed-b');
        const opened = yield* Clock.currentTimeMillis;
        const open = (ref: ExecutionRef, call: string, at: number) =>
          ownUnits.write('CommandDelivery.open', (unit) =>
            ownStore.deliveries.openDelivery(unit, { execution: ref, thread: holder, signalId: commandSignalId(ref, call), openedAt: at }),
          );
        yield* open(first, 'call-5', opened);
        yield* open(second, 'call-6', opened + 1_000);
        const sent: string[] = [];
        const delivery = yield* commandDelivery({
          send: (input) => Effect.sync(() => (sent.push(input.id), { _tag: 'Accepted' } as const)),
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(CommandWaiters, ownWaiters),
              Layer.mock(Terminals, {
                wait: () => Effect.succeed({ _tag: 'Decided', summary: decided(first, { _tag: 'Code', code: 0 }) }),
              }),
              commandsLayer,
              recordsLayer,
            ),
          ),
        );
        expect(yield* delivery.resume()).toBe(2);
        expect(sent).toEqual([commandSignalId(first, 'call-5'), commandSignalId(second, 'call-6')]);
        expect(yield* ownWaiters.owed(first)).toBeNull();
        expect(yield* ownWaiters.owed(second)).toBeNull();
      }).pipe(Effect.provide(Layer.fresh(storage)));
    }),
  );
});
