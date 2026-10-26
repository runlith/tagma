import { Data, Context, Deferred, Effect, Layer, Ref, Schema } from 'effect';
import {
  CapabilityProfile,
  type CountLimit,
  type DescriptorExpenses,
  type ExecutionPolicy,
  type HostGrant,
  type MachineReading,
  type MachineLimits,
  type TransportDescriptors,
  ceilingsOf,
  maximumCeilingsOf,
  countLimits,
  grantOf,
  reserveOf,
} from '@runlith/executions/protocol/capacity';
import { ExecutionId, Transport } from '@runlith/executions/protocol/execution';
import type { PlatformFacts, PlatformIdentity, TransportExpenses, LimitsUnreadable, StandingUnreadable } from './PlatformFacts';
import { recordDescriptors } from './RecordWriter';
import { readerDescriptors } from './ExecutionRecord';
import { countExhaustion } from './hostTelemetry';

export const CapacityBudget = Schema.Literals([
  'host.executions',
  'host.terminals',
  'host.readers',
  'host.bindings',
  'host.reads',
  'execution.read.readers',
  'host.receipts',
  'host.custodyReceipts',
  'execution.receipts',
  'host.tombstones',
]);
export type CapacityBudget = typeof CapacityBudget.Type;

export class CapacityRefused extends Data.TaggedError('CapacityRefused')<{
  readonly budget: typeof CapacityBudget.Type;
  readonly requested: number;
  readonly limit: number;
}> {
  override get message(): string {
    return `${this.budget} needs ${this.requested}, beyond its limit ${this.limit}`;
  }
}

export class MemoryUnavailable extends Data.TaggedError('MemoryUnavailable')<{
  readonly reserve: number;
  readonly reserved: number;
  readonly retained: number;
  readonly grant: number;
}> {
  override get message(): string {
    return `reserve ${this.reserve}, reserved ${this.reserved} and retained ${this.retained} exceed the grant ${this.grant}`;
  }
}

export class TransportRefused extends Data.TaggedError('TransportRefused')<{ readonly transport: typeof Transport.Type }> {
  override get message(): string {
    return `the host profile does not offer ${this.transport}`;
  }
}

export class ReceiptCountInvalid extends Data.TaggedError('ReceiptCountInvalid')<{
  readonly supplied: string;
  readonly reason: 'unsafe' | 'overflow' | 'over-release';
}> {
  override get message(): string {
    return `receipt count ${this.supplied} is refused: ${this.reason}`;
  }
}

export class ProfileInvalid extends Data.TaggedError('ProfileInvalid')<{
  readonly reason: 'policy' | 'artifact';
  readonly detail?: string | undefined;
  readonly field?: string | undefined;
  readonly expected?: string | undefined;
  readonly actual?: string | undefined;
}> {
  override get message(): string {
    return this.detail ?? `${this.field} differs: expected ${this.expected}, received ${this.actual}`;
  }
}

export class ReservationMissing extends Data.TaggedError('ReservationMissing')<{ readonly execution: typeof ExecutionId.Type }> {
  override get message(): string {
    return `no reservation holds ${this.execution}`;
  }
}

export class ReservationConflict extends Data.TaggedError('ReservationConflict')<{ readonly execution: typeof ExecutionId.Type }> {
  override get message(): string {
    return `a reservation already holds ${this.execution}`;
  }
}

export type ExecutionReservation = {
  readonly execution: ExecutionId;
  readonly transport: Transport;
  readonly reserve: number;
  readonly live: boolean;
  readonly settled: boolean;
  readonly terminal: boolean;
  readonly readers: number;
  readonly reads: number;
  readonly receipts: number;
};

export type CapacityState = {
  readonly reserved: number;
  readonly retained: number;
  readonly over: number;
};

export type CapacityLedger = {
  readonly granted: HostGrant;
  readonly reserved: number;
  readonly retained: number;
  readonly executions: number;
  readonly terminals: number;
};

export type LiveCounts = {
  readonly executions: number;
  readonly perTransport: Readonly<Record<Transport, number>>;
  readonly terminals: number;
  readonly terms: ReadonlyArray<CountLimit>;
};

export type DescriptorRoom = { readonly holder: number | 'absent'; readonly logic: number | 'absent' };

export type CapacityAccount = {
  readonly reservations: ReadonlyMap<ExecutionId, ExecutionReservation>;
  readonly reserved: number;
  readonly live: number;
  readonly liveTerminals: number;
  readonly counts: LiveCounts;
  readonly expenses: TransportDescriptors | undefined;
  readonly room: DescriptorRoom;
  readonly promise: DescriptorExpenses;
  readonly measured: ReadonlyMap<ExecutionId, number>;
  readonly retained: number;
  readonly granted: HostGrant;
  readonly tombstones: number;
  readonly custodyReceipts: number;
  readonly readWaiters: ReadonlyArray<Deferred.Deferred<void>>;
};

export const capacityState = (account: CapacityAccount): CapacityState => ({
  reserved: account.reserved,
  retained: account.retained,
  over: Math.max(0, account.reserved + account.retained - account.granted.grantBytes),
});

export class ExecutionCapacity extends Context.Service<
  ExecutionCapacity,
  {
    readonly profile: CapabilityProfile;
    readonly reserve: (
      execution: ExecutionId,
      transport: Transport,
    ) => Effect.Effect<ExecutionReservation, CapacityRefused | MemoryUnavailable | ReservationConflict | TransportRefused>;
    readonly exited: (execution: ExecutionId) => Effect.Effect<void>;
    readonly terminalReleased: (execution: ExecutionId) => Effect.Effect<void>;
    readonly release: (execution: ExecutionId) => Effect.Effect<void>;
    readonly measure: (execution: ExecutionId, bytes: number) => Effect.Effect<CapacityState>;
    readonly regrant: (share: number) => Effect.Effect<CapacityState>;
    readonly connections: (reserve: () => number) => Effect.Effect<void>;
    readonly initialize: (
      platform: PlatformFacts['Service'],
      opened?: () => ReadonlyMap<ExecutionId, number>,
    ) => Effect.Effect<LiveCounts, ProfileInvalid | LimitsUnreadable | StandingUnreadable>;
    readonly recount: (
      platform: PlatformFacts['Service'],
      opened?: () => ReadonlyMap<ExecutionId, number>,
    ) => Effect.Effect<LiveCounts, LimitsUnreadable | StandingUnreadable>;
    readonly counts: () => Effect.Effect<LiveCounts>;
    readonly ledger: () => Effect.Effect<CapacityLedger>;
    readonly reserveReader: (execution: ExecutionId) => Effect.Effect<void, CapacityRefused | ReservationMissing>;
    readonly releaseReader: (execution: ExecutionId) => Effect.Effect<void, ReservationMissing>;
    readonly reserveRead: (execution: ExecutionId) => Effect.Effect<void, CapacityRefused | ReservationMissing>;
    readonly releaseRead: (execution: ExecutionId) => Effect.Effect<void, ReservationMissing>;
    readonly awaitRead: (execution: ExecutionId) => Effect.Effect<void, CapacityRefused | ReservationMissing>;
    readonly reserveReceipt: (execution: ExecutionId) => Effect.Effect<void, CapacityRefused | ReservationMissing>;
    readonly releaseReceipt: (execution: ExecutionId) => Effect.Effect<void, ReservationMissing>;
    readonly reserveTombstone: () => Effect.Effect<void, CapacityRefused>;
    readonly releaseTombstone: () => Effect.Effect<void>;
    readonly reserveCustodyReceipts: (count: number) => Effect.Effect<void, CapacityRefused | ReceiptCountInvalid>;
    readonly releaseCustodyReceipts: (count: number) => Effect.Effect<void, ReceiptCountInvalid>;
    readonly account: () => Effect.Effect<CapacityAccount>;
  }
>()('@runlith/execution-host/ExecutionCapacity') {
  static layer(profile: CapabilityProfile) {
    return Layer.effect(ExecutionCapacity, make({ profile }));
  }

  static descriptors(policy: ExecutionPolicy, expenses: TransportExpenses): TransportDescriptors {
    const expense = (transport: Transport): DescriptorExpenses => ({
      holder: expenses[transport].holder,
      logic: expenses[transport].logic + recordDescriptors(transport) + readerDescriptors(policy.execution, transport),
    });
    return { pipes: expense('pipes'), pty: expense('pty') };
  }

  static profile(policy: ExecutionPolicy, identity: PlatformIdentity, machine: MachineLimits) {
    return qualify(
      {
        ...policy,
        version: PROFILE_VERSION,
        platform: identity.platform,
        runtime: identity.runtime,
        native: identity.native,
        granted: machine.granted,
        ceilings: maximumCeilingsOf(policy, machine),
      },
      identity,
    );
  }

  static forHost(profile: CapabilityProfile, identity: PlatformIdentity) {
    return Layer.effect(
      ExecutionCapacity,
      Effect.flatMap(qualify(profile, identity), (profile) => make({ profile })),
    );
  }
}

const PROFILE_VERSION = 2;

const decodeProfile = Schema.decodeUnknownEffect(CapabilityProfile);

const qualify = Effect.fn('ExecutionCapacity.qualify')(function* (supplied: CapabilityProfile, identity: PlatformIdentity) {
  const profile = yield* decodeProfile(supplied).pipe(
    Effect.mapError((error) => new ProfileInvalid({ reason: 'policy', detail: error.message })),
  );
  const compared: ReadonlyArray<readonly [string, string, string]> = [
    ['version', String(PROFILE_VERSION), String(profile.version)],
    ['platform.os', identity.platform.os, profile.platform.os],
    ['platform.arch', identity.platform.arch, profile.platform.arch],
    ['runtime.name', identity.runtime.name, profile.runtime.name],
    ['runtime.version', identity.runtime.version, profile.runtime.version],
    ['native.crate', identity.native.crate, profile.native.crate],
    ['native.version', identity.native.version, profile.native.version],
    ['native.build', identity.native.build, profile.native.build],
  ];
  for (const [field, expected, actual] of compared) {
    if (expected !== actual) return yield* new ProfileInvalid({ reason: 'artifact', field, expected, actual });
  }
  for (const transport of profile.transports) {
    if (!identity.transports.includes(transport)) {
      return yield* new ProfileInvalid({
        reason: 'artifact',
        field: 'transports',
        expected: identity.transports.join(','),
        actual: transport,
      });
    }
  }
  for (const relation of profile.relations) {
    if (!identity.relations.includes(relation)) {
      return yield* new ProfileInvalid({
        reason: 'artifact',
        field: 'relations',
        expected: identity.relations.join(','),
        actual: relation,
      });
    }
  }
  return profile;
});

type CapacityObservation = {
  readonly account: CapacityAccount;
  readonly opened: ReadonlyMap<ExecutionId, number>;
  readonly reserve: number;
};

type CapacityInput = { readonly profile: CapabilityProfile };
const make = Effect.fn('ExecutionCapacity.make')(function* ({ profile: initial }: CapacityInput) {
  let profile = initial;
  const state = yield* Ref.make<CapacityAccount>({
    reservations: new Map(),
    reserved: 0,
    live: 0,
    liveTerminals: 0,
    counts: {
      executions: Math.max(...profile.transports.map((transport) => profile.ceilings.perTransport[transport])),
      perTransport: profile.ceilings.perTransport,
      terminals: profile.ceilings.terminals,
      terms: [],
    },
    expenses: undefined,
    room: { holder: 'absent', logic: 'absent' },
    promise: { holder: 0, logic: 0 },
    measured: new Map(),
    retained: 0,
    granted: profile.granted,
    tombstones: 0,
    custodyReceipts: 0,
    readWaiters: [],
  });
  const { host, execution: slot } = profile;
  let connectionReserve = () => 0;

  const exceeded = (budget: CapacityBudget, requested: number, limit: number) =>
    requested > limit ? new CapacityRefused({ budget, requested, limit }) : undefined;

  const promising = (account: CapacityAccount, transport: Transport, sign: 1 | -1): DescriptorExpenses => {
    const expense = account.expenses?.[transport];
    return expense === undefined
      ? account.promise
      : { holder: account.promise.holder + sign * expense.holder, logic: account.promise.logic + sign * expense.logic };
  };

  const fixedLogic = (expense: DescriptorExpenses, transport: Transport) =>
    Math.max(0, expense.logic - recordDescriptors(transport) - readerDescriptors(slot, transport));

  const fitting = (account: CapacityAccount, transport: Transport) => {
    const expense = account.expenses?.[transport];
    if (expense === undefined) return undefined;
    const promise = account.promise;
    for (const owner of ['holder', 'logic'] as const) {
      const room = account.room[owner];
      if (room === 'absent') continue;
      const refusal = exceeded(
        'host.executions',
        account.live + 1,
        account.live + Math.floor(Math.max(0, room - promise[owner]) / expense[owner]),
      );
      if (refusal) return refusal;
    }
    return undefined;
  };

  const counted = (account: CapacityAccount, transport: Transport) =>
    exceeded('host.executions', account.live + 1, account.counts.executions) ??
    fitting(account, transport) ??
    exceeded('host.terminals', account.liveTerminals + (transport === 'pty' ? 1 : 0), account.counts.terminals);

  const readersHeld = (reservations: ReadonlyMap<ExecutionId, ExecutionReservation>) =>
    [...reservations.values()].reduce((sum, held) => sum + held.readers, 0);
  const readsHeld = (reservations: ReadonlyMap<ExecutionId, ExecutionReservation>) =>
    [...reservations.values()].reduce((sum, held) => sum + held.reads, 0);
  const receiptsHeld = (reservations: ReadonlyMap<ExecutionId, ExecutionReservation>) =>
    [...reservations.values()].reduce((sum, held) => sum + held.receipts, 0);

  const decide = <A, E>(f: (account: CapacityAccount) => readonly [Effect.Effect<A, E>, CapacityAccount]): Effect.Effect<A, E> =>
    Effect.tapError(Effect.flatten(Ref.modify(state, f)), (failure) =>
      failure instanceof CapacityRefused ? countExhaustion(failure.budget) : Effect.void,
    );

  const withReservation = <A, E>(
    execution: ExecutionId,
    f: (held: ExecutionReservation, account: CapacityAccount) => readonly [Effect.Effect<A, E>, CapacityAccount],
  ) =>
    decide<A, E | ReservationMissing>((account) => {
      const held = account.reservations.get(execution);
      return held === undefined ? [Effect.fail(new ReservationMissing({ execution })), account] : f(held, account);
    });

  const replaced = (account: CapacityAccount, held: ExecutionReservation): CapacityAccount => ({
    ...account,
    reservations: new Map(account.reservations).set(held.execution, held),
  });

  const recount = Effect.fnUntraced(function* (
    platform: PlatformFacts['Service'],
    initializing: boolean,
    opened: () => ReadonlyMap<ExecutionId, number>,
  ) {
    const limits = yield* platform.limits;
    let observed!: CapacityObservation;
    const standing = yield* platform.standing(() => {
      observed = { account: Ref.getUnsafe(state), opened: opened(), reserve: connectionReserve() };
    });
    const machine: MachineReading = {
      granted: observed.account.granted,
      descriptors: ExecutionCapacity.descriptors(profile, platform.descriptors),
      limits,
      standing,
    };
    let openedLogic = 0;
    let openedHolder = 0;
    for (const reservation of observed.account.reservations.values()) {
      const expense = reservation.live ? machine.descriptors[reservation.transport] : undefined;
      if (expense === undefined || (!reservation.settled && !initializing)) continue;
      openedLogic += Math.min(
        expense.logic,
        fixedLogic(expense, reservation.transport) + (observed.opened.get(reservation.execution) ?? 0),
      );
      openedHolder += expense.holder;
    }
    const room = (limit: number | 'absent', held: number) => (limit === 'absent' ? limit : Math.max(0, limit - held));
    return yield* Ref.modify(state, (account) => {
      const normalized: MachineReading = {
        ...machine,
        standing: {
          descriptors: Math.max(0, standing.descriptors + observed.reserve - openedLogic),
          holderDescriptors: Math.max(0, standing.holderDescriptors - openedHolder),
          processes: Math.max(0, standing.processes - account.live),
          terminals: Math.max(0, standing.terminals - account.liveTerminals),
        },
      };
      const derived = ceilingsOf(profile, normalized);
      const counts: LiveCounts = {
        executions: Math.max(...profile.transports.map((transport) => derived.perTransport[transport])),
        perTransport: derived.perTransport,
        terminals: derived.terminals,
        terms: countLimits(profile, normalized),
      };
      let promiseHolder = 0;
      let promiseLogic = 0;
      for (const reservation of account.reservations.values()) {
        if (!reservation.live) continue;
        const expense = machine.descriptors[reservation.transport];
        promiseHolder += expense.holder;
        promiseLogic += expense.logic;
      }
      return [
        { counts, ceilings: derived },
        {
          ...account,
          reservations: new Map(
            [...account.reservations].map(([id, held]) => [
              id,
              { ...held, settled: held.live && (held.settled || observed.account.reservations.get(id)?.live === true) },
            ]),
          ),
          counts,
          expenses: machine.descriptors,
          promise: { holder: promiseHolder, logic: promiseLogic },
          room: {
            holder: room(machine.limits.holderFiles, normalized.standing.holderDescriptors),
            logic: room(machine.limits.openFiles, normalized.standing.descriptors),
          },
        },
      ] as const;
    });
  });

  return ExecutionCapacity.of({
    get profile() {
      return profile;
    },

    reserve: (execution, transport) =>
      decide<ExecutionReservation, CapacityRefused | MemoryUnavailable | ReservationConflict | TransportRefused>((account) => {
        if (account.reservations.has(execution)) return [Effect.fail(new ReservationConflict({ execution })), account];
        if (!profile.transports.includes(transport)) return [Effect.fail(new TransportRefused({ transport })), account];
        const reserve = reserveOf(slot, transport);
        if (account.reserved + reserve > account.granted.grantBytes) {
          return [
            Effect.fail(
              new MemoryUnavailable({
                reserve,
                reserved: account.reserved,
                retained: account.retained,
                grant: account.granted.grantBytes,
              }),
            ),
            account,
          ];
        }
        const refusal = counted(account, transport);
        if (refusal) return [Effect.fail(refusal), account];
        const held: ExecutionReservation = {
          execution,
          transport,
          reserve,
          live: true,
          settled: false,
          terminal: transport === 'pty',
          readers: 0,
          reads: 0,
          receipts: 0,
        };
        return [
          Effect.succeed(held),
          {
            ...replaced(account, held),
            reserved: account.reserved + reserve,
            live: account.live + 1,
            liveTerminals: account.liveTerminals + (transport === 'pty' ? 1 : 0),
            promise: promising(account, transport, 1),
          },
        ];
      }),

    exited: (execution) =>
      Ref.update(state, (account) => {
        const held = account.reservations.get(execution);
        if (held === undefined || !held.live) return account;
        return {
          ...replaced(account, { ...held, live: false }),
          reserved: account.reserved - held.reserve,
          live: account.live - 1,
          promise: promising(account, held.transport, -1),
        };
      }),

    terminalReleased: (execution) =>
      Ref.update(state, (account) => {
        const held = account.reservations.get(execution);
        if (held === undefined || !held.terminal) return account;
        return { ...replaced(account, { ...held, terminal: false }), liveTerminals: account.liveTerminals - 1 };
      }),

    release: (execution) =>
      Ref.update(state, (account) => {
        const held = account.reservations.get(execution);
        if (held === undefined) return account;
        const reservations = new Map(account.reservations);
        reservations.delete(execution);
        const measured = new Map(account.measured);
        const retained = measured.get(execution) ?? 0;
        measured.delete(execution);
        return {
          ...account,
          reservations,
          reserved: account.reserved - (held.live ? held.reserve : 0),
          live: account.live - (held.live ? 1 : 0),
          promise: held.live ? promising(account, held.transport, -1) : account.promise,
          liveTerminals: account.liveTerminals - (held.terminal ? 1 : 0),
          measured,
          retained: account.retained - retained,
        };
      }),

    measure: (execution, bytes) =>
      Ref.modify(state, (account) => {
        if (!account.reservations.has(execution)) return [capacityState(account), account];
        const measured = new Map(account.measured).set(execution, bytes);
        const next = { ...account, measured, retained: account.retained - (account.measured.get(execution) ?? 0) + bytes };
        return [capacityState(next), next];
      }),

    regrant: (share) =>
      Ref.modify(state, (account) => {
        const next = { ...account, granted: grantOf(share, account.granted.machineBytes) };
        return [capacityState(next), next];
      }),

    connections: (reserve) =>
      Effect.sync(() => {
        connectionReserve = reserve;
      }),

    initialize: (platform, opened = () => new Map()) =>
      Effect.flatMap(recount(platform, true, opened), (reading) => {
        if (reading.ceilings.executions < 1)
          return Effect.fail(
            new ProfileInvalid({
              reason: 'policy',
              detail: `kernel occupancy leaves no guaranteed execution across the offered transports: ${reading.counts.terms.map((term) => term.detail).join('; ')}`,
            }),
          );
        profile = { ...profile, ceilings: reading.ceilings };
        return Effect.succeed(reading.counts);
      }),
    recount: (platform, opened = () => new Map()) => Effect.map(recount(platform, false, opened), (reading) => reading.counts),

    counts: () => Effect.map(Ref.get(state), (account) => account.counts),

    ledger: () =>
      Effect.map(Ref.get(state), (account) => ({
        granted: account.granted,
        reserved: account.reserved,
        retained: account.retained,
        executions: account.live,
        terminals: account.liveTerminals,
      })),

    reserveReader: (execution) =>
      withReservation<void, CapacityRefused>(execution, (held, account) => {
        const refusal =
          exceeded('execution.read.readers', held.readers + 1, slot.read.readers) ??
          exceeded('host.readers', readersHeld(account.reservations) + 1, profile.ceilings.readers);
        if (refusal) return [Effect.fail(refusal), account];
        return [Effect.void, replaced(account, { ...held, readers: held.readers + 1 })];
      }),

    releaseReader: (execution) =>
      withReservation<void, never>(execution, (held, account) => [
        Effect.void,
        replaced(account, { ...held, readers: Math.max(0, held.readers - 1) }),
      ]),

    reserveRead: (execution) =>
      withReservation<void, CapacityRefused>(execution, (held, account) => {
        const refusal =
          exceeded('execution.read.readers', held.reads + 1, slot.read.readers) ??
          exceeded('host.reads', readsHeld(account.reservations) + 1, profile.ceilings.reads);
        return refusal ? [Effect.fail(refusal), account] : [Effect.void, replaced(account, { ...held, reads: held.reads + 1 })];
      }),

    releaseRead: (execution) =>
      Effect.flatMap(
        withReservation<ReadonlyArray<Deferred.Deferred<void>>, never>(execution, (held, account) => [
          Effect.succeed(account.readWaiters),
          { ...replaced(account, { ...held, reads: Math.max(0, held.reads - 1) }), readWaiters: [] },
        ]),
        (waiting) => Effect.forEach(waiting, (deferred) => Deferred.succeed(deferred, undefined), { discard: true }),
      ),

    awaitRead: (execution) =>
      Effect.flatten(
        withReservation<Effect.Effect<void, CapacityRefused>, never>(execution, (held, account) => {
          if (held.reads < slot.read.readers && readsHeld(account.reservations) < profile.ceilings.reads) {
            return [Effect.succeed(Effect.void), account];
          }
          const refusal = exceeded('host.reads', account.readWaiters.length + 1, profile.ceilings.reads);
          if (refusal) return [Effect.succeed(Effect.fail(refusal)), account];
          const waiting = Deferred.makeUnsafe<void>();
          return [Effect.succeed(Deferred.await(waiting)), { ...account, readWaiters: [...account.readWaiters, waiting] }];
        }),
      ),

    reserveReceipt: (execution) =>
      withReservation<void, CapacityRefused>(execution, (held, account) => {
        const refusal =
          exceeded('execution.receipts', held.receipts + 1, slot.receipts) ??
          exceeded('host.receipts', receiptsHeld(account.reservations) + 1, profile.ceilings.receipts);
        if (refusal) return [Effect.fail(refusal), account];
        return [Effect.void, replaced(account, { ...held, receipts: held.receipts + 1 })];
      }),

    releaseReceipt: (execution) =>
      withReservation<void, never>(execution, (held, account) => [
        Effect.void,
        replaced(account, { ...held, receipts: Math.max(0, held.receipts - 1) }),
      ]),

    reserveTombstone: () =>
      decide<void, CapacityRefused>((account) => {
        const refusal = exceeded('host.tombstones', account.tombstones + 1, host.tombstones);
        if (refusal) return [Effect.fail(refusal), account];
        return [Effect.void, { ...account, tombstones: account.tombstones + 1 }];
      }),

    releaseTombstone: () => Ref.update(state, (account) => ({ ...account, tombstones: Math.max(0, account.tombstones - 1) })),

    reserveCustodyReceipts: (count) =>
      decide<void, CapacityRefused | ReceiptCountInvalid>((account) => {
        if (!Number.isSafeInteger(count) || count < 0) {
          return [Effect.fail(new ReceiptCountInvalid({ supplied: String(count), reason: 'unsafe' })), account];
        }
        if (count === 0) return [Effect.void, account];
        if (count > Number.MAX_SAFE_INTEGER - account.custodyReceipts) {
          return [Effect.fail(new ReceiptCountInvalid({ supplied: String(count), reason: 'overflow' })), account];
        }
        const requested = account.custodyReceipts + count;
        const refusal = exceeded('host.custodyReceipts', requested, host.custodyReceipts);
        return refusal ? [Effect.fail(refusal), account] : [Effect.void, { ...account, custodyReceipts: requested }];
      }),

    releaseCustodyReceipts: (count) =>
      decide<void, ReceiptCountInvalid>((account) => {
        if (!Number.isSafeInteger(count) || count < 0) {
          return [Effect.fail(new ReceiptCountInvalid({ supplied: String(count), reason: 'unsafe' })), account];
        }
        if (count > account.custodyReceipts) {
          return [Effect.fail(new ReceiptCountInvalid({ supplied: String(count), reason: 'over-release' })), account];
        }
        return [Effect.void, { ...account, custodyReceipts: account.custodyReceipts - count }];
      }),

    account: () => Ref.get(state),
  });
});
