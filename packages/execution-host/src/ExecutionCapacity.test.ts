import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Result } from 'effect';
import { ExecutionCapacity } from './ExecutionCapacity';
import {
  CapabilityProfile,
  type MachineReading,
  ceilingsOf,
  maximumCeilingsOf,
  grantOf,
  reserveOf,
} from '@runlith/executions/protocol/capacity';
import { ExecutionId } from '@runlith/executions/protocol/execution';
import { fixtureFacts, fixtureMachine } from './hostFixture';
import { readerDescriptors } from './ExecutionRecord';
import { recordDescriptors } from './RecordWriter';

const policy = {
  transports: ['pipes', 'pty'],
  relations: ['leader'],
  execution: {
    input: { pendingBytes: 1024, chunkBytes: 1024, receipts: 1 },
    output: { landingBytes: 1024, segmentBytes: 1024, retainedBytes: 4096 },
    parser: { pendingBytes: 512, cellBytes: 512 },
    geometry: { columns: 80, rows: 24, scrollbackRows: 100 },
    read: { chunkBytes: 1024, readerCredits: 2, readers: 2 },
    frame: { bytes: 1024, inFlight: 1 },
    receipts: 2,
  },
  host: { bindings: 2, custodyReceipts: 2, tombstones: 1 },
} as const;
const HOLDER_COST = 4;
const HELD = ExecutionCapacity.descriptors(policy, { pipes: { holder: 4, logic: 0 }, pty: { holder: 4, logic: 0 } });
const LOGIC_COST = Math.max(HELD.pipes.logic, HELD.pty.logic) + 2;
const id = ExecutionId.make;
const handles = (...names: readonly string[]) =>
  new Map(names.map((name) => [id(name), recordDescriptors(name.startsWith('t') ? 'pty' : 'pipes')] as const));
const OPENED = LOGIC_COST - readerDescriptors(policy.execution, 'pipes');
const costs = { pipes: { holder: HOLDER_COST, logic: LOGIC_COST }, pty: { holder: HOLDER_COST, logic: LOGIC_COST } };
const PTY_RESERVE = reserveOf(policy.execution, 'pty');
const PIPES_RESERVE = reserveOf(policy.execution, 'pipes');
const granted = grantOf(0.25, 4 * (2 * PTY_RESERVE + PIPES_RESERVE));
const machine: MachineReading = {
  granted,
  descriptors: costs,
  limits: { openFiles: 3 * LOGIC_COST, holderFiles: 3 * HOLDER_COST, processes: 3, terminals: 3 },
  standing: { terminals: 0, processes: 0, descriptors: 0, holderDescriptors: 0 },
};
const ceilings = { ...ceilingsOf(policy, machine), executions: 3, terminals: 2, perTransport: { pipes: 3, pty: 3 } };
const identity = {
  version: 2,
  platform: { os: 'darwin', arch: 'arm64' },
  runtime: { name: 'bun', version: '1.4.2' },
  native: { crate: 'execution-platform', version: '0.1.0', build: 'fixture' },
} as const;
const profileOf = (over = granted, held = ceilings) => CapabilityProfile.make({ ...identity, ...policy, granted: over, ceilings: held });
const profile = profileOf();
const scarce: MachineReading = {
  granted,
  descriptors: costs,
  limits: { openFiles: LOGIC_COST + 12, holderFiles: 64 * HOLDER_COST, processes: 64, terminals: 64 },
  standing: { terminals: 0, processes: 0, descriptors: 12, holderDescriptors: 0 },
};
const scarceProfile = profileOf(granted, ceilingsOf(policy, scarce));

describe('ExecutionCapacity holds what the grant funds', () => {
  it.effect('a start over the grant refuses for memory, naming the four figures', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      yield* capacity.reserve(id('one'), 'pty');
      yield* capacity.reserve(id('two'), 'pty');
      expect(yield* Effect.flip(capacity.reserve(id('three'), 'pty'))).toMatchObject({
        _tag: 'MemoryUnavailable',
        reserve: PTY_RESERVE,
        reserved: 2 * PTY_RESERVE,
        retained: 0,
        grant: granted.grantBytes,
      });
      expect(yield* capacity.ledger()).toMatchObject({ reserved: 2 * PTY_RESERVE, executions: 2 });
    }).pipe(Effect.provide(ExecutionCapacity.layer(profile))),
  );

  it.effect('history is measured apart from the reserves and never refuses a start', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      yield* capacity.reserve(id('a'), 'pty');
      expect(yield* capacity.measure(id('a'), granted.grantBytes)).toMatchObject({ retained: granted.grantBytes, over: PTY_RESERVE });
      yield* capacity.reserve(id('b'), 'pty');
      expect((yield* capacity.measure(id('gone'), 5_000)).retained).toBe(granted.grantBytes);
      yield* capacity.release(id('a'));
      expect(yield* capacity.ledger()).toMatchObject({ retained: 0, reserved: PTY_RESERVE });
    }).pipe(Effect.provide(ExecutionCapacity.layer(profile))),
  );

  it.effect('a grant lowered below what is held stands over it, and a raised one gives the room back', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      yield* capacity.reserve(id('a'), 'pty');
      expect((yield* capacity.regrant(granted.share / 2)).over).toBe(0);
      expect(yield* Effect.flip(capacity.reserve(id('b'), 'pty'))).toMatchObject({ _tag: 'MemoryUnavailable' });
      expect((yield* capacity.regrant(granted.share)).over).toBe(0);
      yield* capacity.reserve(id('c'), 'pty');
      expect((yield* capacity.ledger()).granted.grantBytes).toBe(granted.grantBytes);
    }).pipe(Effect.provide(ExecutionCapacity.layer(profile))),
  );

  it.effect('a smaller reserve still fits where a terminal does not', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      yield* capacity.reserve(id('a'), 'pty');
      yield* capacity.reserve(id('b'), 'pty');
      yield* capacity.reserve(id('c'), 'pipes');
      expect((yield* capacity.ledger()).reserved).toBe(2 * PTY_RESERVE + PIPES_RESERVE);
    }).pipe(Effect.provide(ExecutionCapacity.layer(profile))),
  );

  it.effect('a start past the descriptors this machine left refuses by name, where the memory would still fit', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      yield* capacity.reserve(id('a'), 'pipes');
      expect(ceilingsOf(policy, scarce).executions).toBe(1);
      expect(yield* Effect.flip(capacity.reserve(id('b'), 'pipes'))).toMatchObject({ _tag: 'CapacityRefused', budget: 'host.executions' });
    }).pipe(Effect.provide(ExecutionCapacity.layer(scarceProfile))),
  );

  it.effect('an exited execution gives its place and its reserve back, and keeps its history measurable', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      yield* capacity.reserve(id('a'), 'pipes');
      expect(yield* Effect.flip(capacity.reserve(id('b'), 'pipes'))).toMatchObject({ budget: 'host.executions' });
      yield* capacity.exited(id('a'));
      yield* capacity.exited(id('a'));
      expect(yield* capacity.ledger()).toMatchObject({ executions: 0, reserved: 0 });
      yield* capacity.reserve(id('b'), 'pipes');
      expect(yield* Effect.flip(capacity.reserve(id('c'), 'pipes'))).toMatchObject({ budget: 'host.executions' });
      expect((yield* capacity.measure(id('a'), 4_096)).retained).toBe(4_096);
      yield* capacity.release(id('a'));
      expect(yield* capacity.ledger()).toMatchObject({ retained: 0, reserved: PIPES_RESERVE, executions: 1 });
    }).pipe(Effect.provide(ExecutionCapacity.layer(scarceProfile))),
  );

  it.effect('a fresh reading of the machine moves the counts a start is gated by, both ways', () =>
    Effect.gen(function* () {
      const live = (count: number): MachineReading => ({ ...scarce, standing: { ...scarce.standing, descriptors: 12 + count * OPENED } });
      const freer: MachineReading = { ...live(1), limits: { ...scarce.limits, openFiles: 3 * LOGIC_COST + 12 } };
      const capacity = yield* ExecutionCapacity;
      yield* capacity.initialize(fixtureFacts(policy, 3, scarce));
      yield* capacity.reserve(id('a'), 'pipes');
      expect(yield* Effect.flip(capacity.reserve(id('b'), 'pipes'))).toMatchObject({ budget: 'host.executions' });
      yield* capacity.recount(fixtureFacts(policy, 3, live(1)));
      expect((yield* capacity.recount(fixtureFacts(policy, 3, freer), () => handles('a'))).executions).toBe(3);
      yield* capacity.reserve(id('b'), 'pipes');
      yield* capacity.recount(fixtureFacts(policy, 3, live(0)), () => handles('a', 'b'));
      const tightened = yield* capacity.recount(fixtureFacts(policy, 3, live(2)), () => handles('a', 'b'));
      expect(tightened.executions).toBe(1);
      expect((yield* capacity.ledger()).executions).toBe(2);
      expect(yield* Effect.flip(capacity.reserve(id('c'), 'pipes'))).toMatchObject({ budget: 'host.executions' });
      expect(tightened.terms.map((term) => term.limit).sort()).toEqual([
        'holder-descriptors',
        'holder-descriptors',
        'logic-descriptors',
        'logic-descriptors',
        'processes',
        'terminals',
      ]);
    }).pipe(Effect.provide(ExecutionCapacity.layer(scarceProfile))),
  );

  it.effect('bootstrap funding keeps an adopted execution while the census and listener reserve close new admission', () => {
    const funding = {
      granted: grantOf(0.25, 4 * 4 * PTY_RESERVE),
      descriptors: costs,
      limits: { openFiles: 4 * LOGIC_COST, holderFiles: 4 * HOLDER_COST, processes: 4, terminals: 4 },
    };
    return Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      yield* capacity.reserve(id('adopted'), 'pipes');
      yield* capacity.connections(() => LOGIC_COST);
      const initialized = yield* capacity.initialize(
        fixtureFacts(policy, 4, {
          ...funding,
          standing: { descriptors: 3 * LOGIC_COST, holderDescriptors: funding.limits.holderFiles, processes: 2, terminals: 0 },
        }),
        () => new Map([[id('adopted'), recordDescriptors('pipes') + readerDescriptors(policy.execution, 'pipes')]]),
      );
      expect(initialized.executions).toBe(1);
      expect(capacity.profile.ceilings.perTransport).toEqual(initialized.perTransport);
      expect(yield* capacity.ledger()).toMatchObject({ executions: 1, reserved: PIPES_RESERVE });
      expect(yield* Effect.flip(capacity.reserve(id('later'), 'pipes'))).toMatchObject({ budget: 'host.executions' });
    }).pipe(Effect.provide(ExecutionCapacity.layer(profileOf(funding.granted, maximumCeilingsOf(policy, funding)))));
  });

  it.effect('a connection and a reservation arriving during globals cannot create descriptor room', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      const sampled = yield* Deferred.make<void>();
      const globals = yield* Deferred.make<void>();
      let reserve = 1;
      let descriptors = 12;
      const reading: MachineReading = { ...scarce, limits: { ...scarce.limits, openFiles: 12 + 2 * LOGIC_COST } };
      const facts = fixtureFacts(policy, 3, reading);
      yield* capacity.connections(() => reserve);
      yield* capacity.initialize(facts);
      const recounting = yield* Effect.forkChild(
        capacity.recount({
          ...facts,
          standing: Effect.fnUntraced(function* (observe) {
            const standing = yield* Effect.sync(() => {
              observe();
              return { ...reading.standing, descriptors };
            });
            yield* Deferred.succeed(sampled, undefined);
            yield* Deferred.await(globals);
            return standing;
          }),
        }),
      );
      yield* Deferred.await(sampled);
      yield* capacity.reserve(id('during-globals'), 'pipes');
      reserve = 0;
      descriptors++;
      yield* Deferred.succeed(globals, undefined);
      expect((yield* Fiber.join(recounting)).executions).toBe(1);
      const after = fixtureFacts(policy, 3, { ...reading, standing: { ...reading.standing, descriptors } });
      expect((yield* capacity.recount(after)).executions).toBe(1);
      expect(yield* Effect.flip(capacity.reserve(id('beyond'), 'pipes'))).toMatchObject({ budget: 'host.executions' });
    }).pipe(Effect.provide(ExecutionCapacity.layer(profile))),
  );

  it.effect('late process and terminal globals subtract the current owned population after an exit', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      const sampled = yield* Deferred.make<void>();
      const globals = yield* Deferred.make<void>();
      yield* capacity.reserve(id('remaining'), 'pty');
      yield* capacity.reserve(id('ending'), 'pty');
      const facts = fixtureFacts(policy, 3, {
        ...machine,
        limits: { openFiles: 'absent', holderFiles: 'absent', processes: 3, terminals: 2 },
        standing: { descriptors: 0, holderDescriptors: 0, processes: 3, terminals: 2 },
      });
      const initializing = yield* Effect.forkChild(
        capacity.initialize({
          ...facts,
          standing: Effect.fnUntraced(function* (observe) {
            yield* Effect.sync(observe);
            yield* Deferred.succeed(sampled, undefined);
            yield* Deferred.await(globals);
            return { descriptors: 0, holderDescriptors: 0, processes: 3, terminals: 2 };
          }),
        }),
      );
      yield* Deferred.await(sampled);
      yield* capacity.exited(id('ending'));
      yield* capacity.terminalReleased(id('ending'));
      yield* Deferred.succeed(globals, undefined);
      expect(yield* Fiber.join(initializing)).toMatchObject({ executions: 1, terminals: 1 });
      expect(yield* Effect.flip(capacity.reserve(id('beyond'), 'pipes'))).toMatchObject({ budget: 'host.executions' });
    }).pipe(Effect.provide(ExecutionCapacity.layer(profile))),
  );

  it.effect('initialization refuses a zero guaranteed declaration instead of publishing a profile the wire cannot encode', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      const previous = capacity.profile;
      expect(
        yield* Effect.flip(
          capacity.initialize(
            fixtureFacts(policy, 3, {
              ...machine,
              descriptors: { pipes: { holder: 4, logic: 4 }, pty: { holder: 2, logic: 2 } },
              limits: { openFiles: 4, holderFiles: 4, processes: 4, terminals: 4 },
              standing: { descriptors: 2, holderDescriptors: 2, processes: 0, terminals: 0 },
            }),
          ),
        ),
      ).toMatchObject({ _tag: 'ProfileInvalid', reason: 'policy' });
      expect(capacity.profile).toEqual(previous);
    }).pipe(Effect.provide(ExecutionCapacity.layer(profile))),
  );

  it.effect('the initialized declaration remains coherent when a later census has no room for another execution', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      const opened = yield* capacity.initialize(fixtureFacts(policy, 3, machine));
      const exhausted = yield* capacity.recount(
        fixtureFacts(policy, 3, {
          ...machine,
          standing: { ...machine.standing, descriptors: machine.limits.openFiles === 'absent' ? 0 : machine.limits.openFiles },
        }),
      );
      expect(opened.executions).toBe(3);
      expect(exhausted.executions).toBe(0);
      expect(capacity.profile.ceilings.perTransport).toEqual(opened.perTransport);
      expect(capacity.profile.ceilings.executions).toBe(Math.min(opened.perTransport.pipes, opened.perTransport.pty));
      expect(yield* Effect.flip(capacity.reserve(id('later'), 'pipes'))).toMatchObject({ budget: 'host.executions' });
    }).pipe(Effect.provide(ExecutionCapacity.layer(profile))),
  );

  it.effect('the pty maximum bounds terminals alone, never the executions that can never take one', () => {
    const fewPtys: MachineReading = {
      granted,
      descriptors: costs,
      limits: { openFiles: 16 * LOGIC_COST, holderFiles: 16 * HOLDER_COST, processes: 16, terminals: 2 },
      standing: { terminals: 0, processes: 0, descriptors: 0, holderDescriptors: 0 },
    };
    const derived = ceilingsOf(policy, fewPtys);
    return Effect.gen(function* () {
      expect(derived).toMatchObject({ perTransport: { pipes: 16, pty: 2 }, executions: 2, terminals: 2 });
      const capacity = yield* ExecutionCapacity;
      yield* capacity.reserve(id('p1'), 'pipes');
      yield* capacity.reserve(id('p2'), 'pipes');
      yield* capacity.reserve(id('p3'), 'pipes');
      yield* capacity.reserve(id('t1'), 'pty');
      yield* capacity.reserve(id('t2'), 'pty');
      expect(yield* Effect.flip(capacity.reserve(id('t3'), 'pty'))).toMatchObject({ budget: 'host.terminals' });
    }).pipe(Effect.provide(ExecutionCapacity.layer(profileOf(grantOf(0.25, 4 * (4 * PTY_RESERVE + 8 * PIPES_RESERVE)), derived))));
  });

  it.effect('each transport debits its own descriptors, the connection reserve narrows every recount, and exits return the room', () => {
    const expense = ExecutionCapacity.descriptors(policy, { pipes: { holder: 2, logic: 2 }, pty: { holder: 4, logic: 2 } });
    const openedOf = (transport: 'pipes' | 'pty') => expense[transport].logic - readerDescriptors(policy.execution, transport);
    const mixed: MachineReading = {
      granted: grantOf(0.25, 4 * (8 * PTY_RESERVE)),
      descriptors: expense,
      limits: { openFiles: 4 + 2 * expense.pty.logic + 2 * expense.pipes.logic, holderFiles: 64, processes: 64, terminals: 64 },
      standing: { terminals: 0, processes: 0, descriptors: 0, holderDescriptors: 0 },
    };
    return Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      yield* capacity.connections(() => 4);
      const opened = yield* capacity.initialize(fixtureFacts(policy, 3, mixed));
      for (const name of ['t1', 't2']) yield* capacity.reserve(id(name), 'pty');
      for (const name of ['p1', 'p2']) yield* capacity.reserve(id(name), 'pipes');
      expect(yield* Effect.flip(capacity.reserve(id('p3'), 'pipes'))).toMatchObject({ budget: 'host.executions' });
      yield* capacity.recount(fixtureFacts(policy, 3, mixed));
      const census = { ...mixed, standing: { ...mixed.standing, descriptors: 2 * openedOf('pty') + 2 * openedOf('pipes') } };
      const again = yield* capacity.recount(fixtureFacts(policy, 3, census), () => handles('t1', 't2', 'p1', 'p2'));
      expect(yield* Effect.flip(capacity.reserve(id('p3'), 'pipes'))).toMatchObject({ budget: 'host.executions' });
      yield* capacity.exited(id('t1'));
      expect(yield* Effect.flip(capacity.reserve(id('p3'), 'pipes'))).toMatchObject({ budget: 'host.executions' });
      yield* capacity.exited(id('p1'));
      yield* capacity.reserve(id('p3'), 'pipes');
      expect(expense).toMatchObject({ pipes: { logic: 11 }, pty: { logic: 7 } });
      expect(opened.perTransport).toEqual({ pipes: 3, pty: 5 });
      expect(again.perTransport).toEqual(opened.perTransport);
    }).pipe(Effect.provide(ExecutionCapacity.layer(profileOf(mixed.granted, ceilingsOf(policy, mixed)))));
  });

  it.effect('executions that have opened less than they were promised keep their promise out of the free room', () => {
    const expense = ExecutionCapacity.descriptors(policy, { pipes: { holder: 2, logic: 2 }, pty: { holder: 4, logic: 2 } });
    const standing = 20;
    const machineOf = (descriptors: number): MachineReading => ({
      granted,
      descriptors: expense,
      limits: { openFiles: standing + 2 * expense.pipes.logic, holderFiles: 64, processes: 64, terminals: 64 },
      standing: { terminals: 0, processes: 0, descriptors, holderDescriptors: 0 },
    });
    return Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      yield* capacity.initialize(fixtureFacts(policy, 3, machineOf(standing)));
      yield* capacity.reserve(id('quiet'), 'pipes');
      yield* capacity.recount(fixtureFacts(policy, 3, machineOf(standing)));
      yield* capacity.recount(fixtureFacts(policy, 3, machineOf(standing + 1)));
      yield* capacity.reserve(id('second'), 'pipes');
      expect(yield* Effect.flip(capacity.reserve(id('third'), 'pipes'))).toMatchObject({ budget: 'host.executions' });
    }).pipe(Effect.provide(ExecutionCapacity.layer(profileOf(granted, ceilingsOf(policy, machineOf(standing))))));
  });

  it.effect(
    'room an exit freed before the kernel released its descriptors is phantom, and a re-measure turns the next start into an honest refusal',
    () =>
      Effect.gen(function* () {
        const capacity = yield* ExecutionCapacity;
        yield* capacity.initialize(fixtureFacts(policy, 3, scarce));
        yield* capacity.reserve(id('a'), 'pipes');
        const census = { ...scarce, standing: { ...scarce.standing, descriptors: 12 + OPENED } };
        yield* capacity.recount(fixtureFacts(policy, 3, census));
        yield* capacity.recount(fixtureFacts(policy, 3, census), () => handles('a'));
        yield* capacity.exited(id('a'));
        yield* capacity.reserve(id('b'), 'pipes');
        yield* capacity.exited(id('b'));
        yield* capacity.recount(fixtureFacts(policy, 3, census));
        expect(yield* Effect.flip(capacity.reserve(id('c'), 'pipes'))).toMatchObject({ budget: 'host.executions' });
      }).pipe(Effect.provide(ExecutionCapacity.layer(scarceProfile))),
  );

  it.effect('a reader or viewer lease opens no descriptor, so it never turns promised room into free room', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      yield* capacity.initialize(fixtureFacts(policy, 3, scarce));
      yield* capacity.reserve(id('a'), 'pipes');
      const census = { ...scarce, standing: { ...scarce.standing, descriptors: 12 + OPENED } };
      yield* capacity.recount(fixtureFacts(policy, 3, census), () => handles('a'));
      const idle = yield* capacity.recount(fixtureFacts(policy, 3, census), () => handles('a'));
      yield* capacity.reserveReader(id('a'));
      yield* capacity.reserveReader(id('a'));
      expect((yield* capacity.recount(fixtureFacts(policy, 3, census), () => handles('a'))).perTransport).toEqual(idle.perTransport);
    }).pipe(Effect.provide(ExecutionCapacity.layer(scarceProfile))),
  );

  it.effect('a pipes-only profile refuses PTY before reserving anything', () => {
    const pipesOnly = { ...policy, transports: ['pipes'] } as const;
    const pipesMachine = fixtureMachine(pipesOnly, 2);
    return Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      expect(yield* Effect.flip(capacity.reserve(id('shell'), 'pty'))).toMatchObject({ _tag: 'TransportRefused' });
      expect((yield* capacity.ledger()).executions).toBe(0);
      expect((yield* capacity.reserve(id('shell'), 'pipes')).transport).toBe('pipes');
    }).pipe(
      Effect.provide(
        ExecutionCapacity.layer(
          CapabilityProfile.make({
            ...identity,
            ...pipesOnly,
            granted: pipesMachine.granted,
            ceilings: ceilingsOf(pipesOnly, pipesMachine),
          }),
        ),
      ),
    );
  });

  it.effect('concurrent reservations never exceed the grant, and the refusal names what it needed', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      const results = yield* Effect.forEach(['a', 'b', 'c'], (name) => Effect.result(capacity.reserve(id(name), 'pty')), {
        concurrency: 3,
      });
      expect(yield* capacity.ledger()).toMatchObject({ executions: 2, reserved: 2 * PTY_RESERVE });
      const failures = results.filter(Result.isFailure);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.failure).toMatchObject({ _tag: 'MemoryUnavailable' });
    }).pipe(Effect.provide(ExecutionCapacity.layer(profile))),
  );

  it.effect('a reserve is taken once, and releasing it twice releases it once', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      yield* capacity.reserve(id('a'), 'pipes');
      expect(yield* Effect.flip(capacity.reserve(id('a'), 'pty'))).toMatchObject({ _tag: 'ReservationConflict' });
      yield* capacity.release(id('a'));
      yield* capacity.release(id('a'));
      expect(yield* capacity.ledger()).toMatchObject({ executions: 0, reserved: 0 });
    }).pipe(Effect.provide(ExecutionCapacity.layer(profile))),
  );

  it.effect('external reads have a global in-flight limit and reserved buffer headroom', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      yield* capacity.reserve(id('a'), 'pipes');
      yield* capacity.reserve(id('b'), 'pipes');
      yield* capacity.reserveRead(id('a'));
      yield* capacity.reserveRead(id('a'));
      yield* capacity.reserveRead(id('b'));
      expect(yield* Effect.flip(capacity.reserveRead(id('b')))).toMatchObject({ budget: 'host.reads' });
      yield* capacity.reserveReader(id('b'));
      yield* capacity.releaseRead(id('a'));
      yield* capacity.reserveRead(id('b'));
      const account = yield* capacity.account();
      expect(account.reservations.get(id('a'))?.reads).toBe(1);
      expect(account.reservations.get(id('b'))).toMatchObject({ reads: 2, readers: 1 });
    }).pipe(Effect.provide(ExecutionCapacity.layer(profileOf(granted, { ...ceilingsOf(policy, machine), reads: 3, readers: 3 })))),
  );

  it.effect('host custody keys have their own bounded budget and known rollback returns a charge', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      yield* capacity.reserveTombstone();
      yield* capacity.reserveCustodyReceipts(2);
      expect(yield* Effect.flip(capacity.reserveCustodyReceipts(1))).toMatchObject({ budget: 'host.custodyReceipts' });
      yield* capacity.releaseCustodyReceipts(1);
      yield* capacity.reserveCustodyReceipts(1);
      expect(yield* Effect.flip(capacity.releaseCustodyReceipts(3))).toMatchObject({ _tag: 'ReceiptCountInvalid' });
      expect(yield* capacity.account()).toMatchObject({ custodyReceipts: 2, tombstones: 1 });
    }).pipe(Effect.provide(ExecutionCapacity.layer(profile))),
  );

  it.effect('receipts refuse on the execution budget, then on the host budget, and return with the reserve', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      yield* capacity.reserve(id('a'), 'pipes');
      yield* capacity.reserve(id('b'), 'pipes');
      yield* capacity.reserveReceipt(id('a'));
      yield* capacity.reserveReceipt(id('a'));
      expect(yield* Effect.flip(capacity.reserveReceipt(id('a')))).toMatchObject({ budget: 'execution.receipts' });
      yield* capacity.reserveReceipt(id('b'));
      expect(yield* Effect.flip(capacity.reserveReceipt(id('b')))).toMatchObject({ budget: 'host.receipts' });
      yield* capacity.release(id('a'));
      yield* capacity.reserveReceipt(id('b'));
    }).pipe(Effect.provide(ExecutionCapacity.layer(profileOf(granted, { ...ceilingsOf(policy, machine), receipts: 3 })))),
  );

  it.effect('a released execution is room again, and its readers go with it', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      yield* capacity.reserve(id('a'), 'pty');
      yield* capacity.reserve(id('b'), 'pty');
      yield* capacity.reserveReader(id('a'));
      yield* capacity.reserveReader(id('a'));
      expect(yield* Effect.flip(capacity.reserveReader(id('a')))).toMatchObject({ budget: 'execution.read.readers' });
      yield* capacity.release(id('a'));
      expect(yield* Effect.flip(capacity.reserveReader(id('a')))).toMatchObject({ _tag: 'ReservationMissing' });
      yield* capacity.reserve(id('c'), 'pty');
      expect([...(yield* capacity.account()).reservations.keys()].map(String).sort()).toEqual(['b', 'c']);
    }).pipe(Effect.provide(ExecutionCapacity.layer(profile))),
  );

  it.effect('a tombstone counts against its own budget and is given back', () =>
    Effect.gen(function* () {
      const capacity = yield* ExecutionCapacity;
      yield* capacity.reserveTombstone();
      expect(yield* Effect.flip(capacity.reserveTombstone())).toMatchObject({ budget: 'host.tombstones' });
      yield* capacity.releaseTombstone();
      yield* capacity.reserveTombstone();
    }).pipe(Effect.provide(ExecutionCapacity.layer(profile))),
  );
});
