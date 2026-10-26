import { Data, Context, Effect, Layer, Ref } from 'effect';
import { BindingId, Principal } from '@runlith/executions/protocol/custody';
import { ConnectionId, CustodianEpoch, HostCustody } from '@runlith/executions/protocol/registration';
import { ExecutionId } from '@runlith/executions/protocol/execution';
import { Custodian, type CustodianRefused } from './Custodian';
import type { CustodyLost } from './store/errors';
import { CapacityRefused, ExecutionCapacity } from './ExecutionCapacity';

export type Binding = {
  readonly id: BindingId;
  readonly principal: Principal;
  readonly epoch: CustodianEpoch;
  readonly execution?: ExecutionId;
};

export type BindingClaim = {
  readonly binding: BindingId;
  readonly principal: Principal;
  readonly connection: ConnectionId;
  readonly epoch: CustodianEpoch;
};

export class BindingMissing extends Data.TaggedError('BindingMissing')<{ readonly binding: typeof BindingId.Type }> {
  override get message(): string {
    return `no binding ${this.binding} is open`;
  }
}

export class BindingRefused extends Data.TaggedError('BindingRefused')<{
  readonly binding: typeof BindingId.Type;
  readonly epoch: typeof CustodianEpoch.Type;
}> {
  override get message(): string {
    return `binding ${this.binding} belongs to custodian epoch ${this.epoch}`;
  }
}

export class PrincipalInvalid extends Data.TaggedError('PrincipalInvalid')<{
  readonly binding: typeof BindingId.Type;
  readonly presented: typeof Principal.Type;
}> {
  override get message(): string {
    return `${this.presented} is not the principal of binding ${this.binding}`;
  }
}

export class LaneRefused extends Data.TaggedError('LaneRefused')<{
  readonly binding: typeof BindingId.Type;
  readonly presented: typeof ExecutionId.Type;
}> {
  override get message(): string {
    return `binding ${this.binding} cannot admit input to execution ${this.presented}`;
  }
}

export class Bindings extends Context.Service<
  Bindings,
  {
    readonly open: (
      principal: Principal,
      connection: ConnectionId,
      epoch: CustodianEpoch,
    ) => Effect.Effect<Binding, CustodianRefused | CustodyLost | CapacityRefused>;
    readonly authorize: (
      claim: BindingClaim,
      into?: ExecutionId,
    ) => Effect.Effect<Binding, CustodianRefused | CustodyLost | BindingMissing | BindingRefused | PrincipalInvalid | LaneRefused>;
    readonly close: (binding: BindingId, principal: Principal) => Effect.Effect<ExecutionId | undefined>;
    readonly endLanes: (execution: ExecutionId) => Effect.Effect<void>;
    readonly prune: () => Effect.Effect<number>;
  }
>()('@runlith/execution-host/Bindings') {
  static readonly layer = Layer.effect(
    Bindings,
    Effect.suspend(() => make),
  );
}

const liveUnder = (entry: Binding, custody: HostCustody): boolean =>
  entry.epoch > custody.epoch || (entry.epoch === custody.epoch && custody.holder !== undefined);

const make = Effect.gen(function* () {
  const custodian = yield* Custodian;
  const capacity = yield* ExecutionCapacity;
  const limit = capacity.profile.host.bindings;
  const table = yield* Ref.make<ReadonlyMap<BindingId, Binding>>(new Map());

  const sweep = (keep: (entry: Binding) => boolean) =>
    Ref.modify(table, (bindings) => {
      const kept = new Map<BindingId, Binding>();
      for (const [id, entry] of bindings) if (keep(entry)) kept.set(id, entry);
      const forgotten = bindings.size - kept.size;
      return [forgotten, kept];
    });

  const forget = (id: BindingId) =>
    Ref.update(table, (bindings) => {
      if (!bindings.has(id)) return bindings;
      const kept = new Map(bindings);
      kept.delete(id);
      return kept;
    });

  return Bindings.of({
    open: Effect.fnUntraced(function* (principal, connection, epoch) {
      const custody = yield* custodian.check(epoch, connection);
      const binding: Binding = {
        id: BindingId.make(yield* Effect.sync(() => crypto.randomUUID())),
        principal,
        epoch: custody.epoch,
      };
      return yield* Effect.flatten(
        Ref.modify(table, (bindings): readonly [Effect.Effect<Binding, CapacityRefused>, ReadonlyMap<BindingId, Binding>] => {
          const kept = new Map([...bindings].filter(([, entry]) => liveUnder(entry, custody)));
          if (kept.size >= limit) {
            return [Effect.fail(new CapacityRefused({ budget: 'host.bindings', requested: kept.size + 1, limit })), kept];
          }
          kept.set(binding.id, binding);
          return [Effect.succeed(binding), kept];
        }),
      );
    }),

    authorize: Effect.fnUntraced(function* (claim, into) {
      const entry = (yield* Ref.get(table)).get(claim.binding);
      const custody = yield* custodian.check(claim.epoch, claim.connection);
      if (entry === undefined) return yield* new BindingMissing({ binding: claim.binding });
      if (entry.epoch !== custody.epoch) {
        yield* forget(claim.binding);
        return yield* new BindingRefused({ binding: claim.binding, epoch: entry.epoch });
      }
      if (entry.principal !== claim.principal) {
        return yield* new PrincipalInvalid({ binding: claim.binding, presented: claim.principal });
      }
      if (into === undefined) return entry;
      return yield* Effect.flatten(
        Ref.modify(table, (bindings): readonly [Effect.Effect<Binding, BindingMissing | LaneRefused>, ReadonlyMap<BindingId, Binding>] => {
          const standing = bindings.get(claim.binding);
          if (standing === undefined) return [Effect.fail(new BindingMissing({ binding: claim.binding })), bindings];
          if (standing.execution === into) return [Effect.succeed(standing), bindings];
          if (standing.execution !== undefined) {
            return [Effect.fail(new LaneRefused({ binding: claim.binding, presented: into })), bindings];
          }
          const bound: Binding = { ...standing, execution: into };
          return [Effect.succeed(bound), new Map(bindings).set(claim.binding, bound)];
        }),
      );
    }),

    close: (id, principal) =>
      Ref.modify(table, (bindings): readonly [ExecutionId | undefined, ReadonlyMap<BindingId, Binding>] => {
        const entry = bindings.get(id);
        if (entry === undefined || entry.principal !== principal) return [undefined, bindings];
        const kept = new Map(bindings);
        kept.delete(id);
        return [entry.execution, kept];
      }),

    endLanes: (execution) => Effect.asVoid(sweep((entry) => entry.execution !== execution)),

    prune: Effect.fnUntraced(function* () {
      const standing = yield* custodian.current();
      return yield* standing._tag === 'Unresolved'
        ? sweep((entry) => entry.epoch >= standing.last.epoch)
        : sweep((entry) => liveUnder(entry, standing.custody));
    }),
  });
});
