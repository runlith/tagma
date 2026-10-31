import { Clock, Context, Effect, Fiber, Layer, Schema } from 'effect';

const count = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.mutableKey);

const costCountsSchema = Schema.Struct({
  statements: count,
  units: count,
  programs: count,
  programStatements: count,
  writerHoldMs: count,
  writerWaitMs: count,
  requestBytes: count,
  responseBytes: count,
  spans: count,
});
export type CostCounts = typeof costCountsSchema.Type;

const costCursorSchema = Schema.Struct({
  ledgerId: Schema.String.check(Schema.isMinLength(1)),
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type CostCursor = typeof costCursorSchema.Type;

export const costReadSchema = Schema.Struct({
  rootId: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  after: Schema.optional(costCursorSchema),
  limit: Schema.Int.check(Schema.isGreaterThan(0)),
});
type CostRead = typeof costReadSchema.Type;

const costRowSchema = Schema.Struct({
  id: Schema.String,
  sequence: Schema.Int,
  name: Schema.String,
  startedAt: Schema.Number,
  endedAt: Schema.NullOr(Schema.Number),
  total: costCountsSchema,
  own: costCountsSchema,
  producers: Schema.Array(Schema.Struct({ name: Schema.String, counts: costCountsSchema })),
});
export type CostRow = typeof costRowSchema.Type;

export const costPageSchema = Schema.Struct({
  ledgerId: Schema.String,
  reset: Schema.Boolean,
  rows: Schema.Array(costRowSchema),
  total: Schema.Int,
  next: Schema.NullOr(costCursorSchema),
  evicted: Schema.Int,
  unattributedStatements: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type CostPage = typeof costPageSchema.Type;

const root = Symbol('CostLedger.root');

type Root = {
  readonly id: string;
  readonly sequence: number;
  readonly name: string;
  readonly startedAt: number;
  endedAt: number | null;
  readonly own: CostCounts;
  readonly producers: Map<string, CostCause>;
  readonly close: () => void;
};

export interface CostCause {
  readonly counts: CostCounts;
  readonly [root]: Root;
}

export const CurrentCost = Context.Reference<CostCause | null>('@runlith/performance/CurrentCost', { defaultValue: () => null });

export const costRootId = (cause: CostCause): string => cause[root].id;

export class CostLedger extends Context.Service<
  CostLedger,
  {
    readonly read: (query: CostRead) => CostPage;
    readonly open: (name: string, id?: string) => CostCause;
  }
>()('@runlith/performance/CostLedger') {}

const emptyCounts = (): CostCounts => ({
  statements: 0,
  units: 0,
  programs: 0,
  programStatements: 0,
  writerHoldMs: 0,
  writerWaitMs: 0,
  requestBytes: 0,
  responseBytes: 0,
  spans: 0,
});

const addCounts = (total: CostCounts, counts: CostCounts): void => {
  total.statements += counts.statements;
  total.units += counts.units;
  total.programs += counts.programs;
  total.programStatements += counts.programStatements;
  total.writerHoldMs += counts.writerHoldMs;
  total.writerWaitMs += counts.writerWaitMs;
  total.requestBytes += counts.requestBytes;
  total.responseBytes += counts.responseBytes;
  total.spans += counts.spans;
};

const producerCause = (cause: CostCause, name: string): CostCause => {
  const owner = cause[root];
  const found = owner.producers.get(name);
  if (found !== undefined) return found;
  const producer: CostCause = { counts: emptyCounts(), [root]: owner };
  owner.producers.set(name, producer);
  return producer;
};

const readRoot = (owner: Root): CostRow => {
  const own = { ...owner.own };
  const total = { ...own };
  const producers = Array.from(owner.producers, ([name, cause]) => {
    const counts = { ...cause.counts };
    addCounts(total, counts);
    return { name, counts };
  });
  return {
    id: owner.id,
    sequence: owner.sequence,
    name: owner.name,
    startedAt: owner.startedAt,
    endedAt: owner.endedAt,
    total,
    own,
    producers,
  };
};

type CostLedgerOptions = { readonly capacity: number; readonly unattributedStatements?: () => number };

const makeCostLedger = Effect.fnUntraced(function* (input: CostLedgerOptions) {
  const clock = yield* Clock.Clock;
  const ledgerId = globalThis.crypto.randomUUID();
  const roots = new Map<number, Root>();
  let sequence = 0;
  let evicted = 0;
  const capacity = Math.max(1, Math.floor(input.capacity));
  return CostLedger.of({
    open: (name, id) => {
      const own = emptyCounts();
      const owner: Root = {
        id: id ?? globalThis.crypto.randomUUID(),
        sequence: ++sequence,
        name,
        startedAt: clock.currentTimeMillisUnsafe(),
        endedAt: null,
        own,
        producers: new Map(),
        close: () => {
          owner.endedAt ??= clock.currentTimeMillisUnsafe();
        },
      };
      roots.set(sequence, owner);
      if (roots.size > capacity) {
        roots.delete(roots.keys().next().value!);
        evicted++;
      }
      return { counts: own, [root]: owner };
    },
    read: (query) => {
      const reset = query.after !== undefined && query.after.ledgerId !== ledgerId;
      const after = reset ? 0 : (query.after?.sequence ?? 0);
      const rows: CostRow[] = [];
      let total = query.rootId === undefined ? roots.size : 0;
      let more = false;
      for (const owner of roots.values()) {
        if (query.rootId !== undefined && owner.id !== query.rootId) continue;
        if (query.rootId !== undefined) total++;
        if (owner.sequence <= after) continue;
        if (rows.length < query.limit) rows.push(readRoot(owner));
        else {
          more = true;
          if (query.rootId === undefined) break;
        }
      }
      return {
        ledgerId,
        reset,
        rows,
        total,
        next: more ? { ledgerId, sequence: rows.at(-1)!.sequence } : null,
        evicted,
        unattributedStatements: input.unattributedStatements?.() ?? null,
      };
    },
  });
});

export const endCost = (cause: CostCause): void => cause[root].close();

export const costLedgerLayer = (input: CostLedgerOptions) => Layer.effect(CostLedger, makeCostLedger(input));

export const rootCost = <A, E, R>(name: string, work: Effect.Effect<A, E, R>, id?: string): Effect.Effect<A, E, R> =>
  Effect.withFiber((fiber) => {
    if (Context.get(fiber.context, CurrentCost) !== null) return work;
    const ledger = Context.getOrUndefined(fiber.context, CostLedger);
    if (ledger === undefined) return work;
    return Effect.acquireUseRelease(
      Effect.sync(() => ledger.open(name, id)),
      (cause) => Effect.provideService(work, CurrentCost, cause),
      (cause) => Effect.sync(() => endCost(cause)),
    );
  });

export const producerCost = <A, E, R>(name: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.withFiber((fiber) => {
    const cause = Context.get(fiber.context, CurrentCost);
    return cause === null ? rootCost(name, work) : Effect.provideService(work, CurrentCost, producerCause(cause, name));
  });

export const carryCost = <A, E, R>(work: Effect.Effect<A, E, R>, producer?: string): Effect.Effect<A, E, R> => {
  const context = Fiber.getCurrent()?.context;
  const cause = context === undefined ? null : Context.get(context, CurrentCost);
  const carried = producer === undefined ? work : producerCost(producer, work);
  return cause === null ? carried : Effect.provideService(carried, CurrentCost, cause);
};
