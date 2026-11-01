import { and, eq, sql } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import type { TransportBinding } from '@runlith/agent/thread/record';
import type { TransportCapabilities, TransportCopies } from '@runlith/agent/thread/record';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { Unit } from '../../platform/contract/service/units.js';
import type { HarnessAskedModel } from '../contract/wire/harness/askedModel.js';
import type { HarnessRoad, KernelSeat } from '../contract/wire/harness/seat.js';
import { thread } from './kernel.js';

export const seatColumns = (seat: KernelSeat) => ({
  provider: seat.selection.provider,
  model: seat.selection.model,
  reasoning: seat.selection.reasoning,
  account: seat.account,
  switches: seat.switches,
  transport: seat.transport,
  capabilities: seat.capabilities,
});

export const seatKernel = Effect.fn('ThreadSeat.record')(function* (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  threadId: string,
  seat: KernelSeat,
) {
  const updatedAt = new Date(yield* Clock.currentTimeMillis);
  yield* unit.run(
    db
      .insert(thread)
      .values({ id: threadId, cacheGroup: threadId, ...seatColumns(seat), updatedAt })
      .onConflictDoUpdate({ target: thread.id, set: { ...seatColumns(seat), updatedAt } }),
  );
  yield* unit.run(db.run(sql`insert into thread_log (thread_id) values (${threadId}) on conflict do nothing`));
});

export type DeclaredByAgent = {
  readonly pictures: boolean;
  readonly steer: TransportCapabilities['steer'];
  readonly withdraw: boolean;
  readonly toolCatalog: TransportCapabilities['toolCatalog'];
};

export const declareCapabilities = Effect.fn('ThreadSeat.declareCapabilities')(function* (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  threadId: string,
  declared: DeclaredByAgent,
): Effect.fn.Return<void, StoreFailure> {
  const updatedAt = new Date(yield* Clock.currentTimeMillis);
  const set = sql`json_set(${thread.capabilities}, '$.pictures', json(${declared.pictures ? 'true' : 'false'}), '$.steer', ${declared.steer}, '$.withdraw', json(${declared.withdraw ? 'true' : 'false'}))`;
  const catalog = declared.toolCatalog ?? null;
  yield* unit.run(
    db
      .update(thread)
      .set({
        capabilities: (catalog === null
          ? sql`json_remove(${set}, '$.toolCatalog')`
          : sql`json_set(${set}, '$.toolCatalog', ${catalog})`) as never,
        updatedAt,
      })
      .where(
        and(
          eq(thread.id, threadId),
          sql`(json_extract(${thread.capabilities}, '$.pictures') is not ${declared.pictures ? 1 : 0}
              or json_extract(${thread.capabilities}, '$.steer') is not ${declared.steer}
              or json_extract(${thread.capabilities}, '$.withdraw') is not ${declared.withdraw ? 1 : 0}
              or json_extract(${thread.capabilities}, '$.toolCatalog') is not ${catalog})`,
        ),
      ),
  );
});

export type DeclaredHistory = { readonly history: TransportCapabilities['history']; readonly copies: TransportCopies };

export const declareHistory = Effect.fn('ThreadSeat.declareHistory')(function* (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  threadId: string,
  declared: DeclaredHistory,
): Effect.fn.Return<void, StoreFailure> {
  const updatedAt = new Date(yield* Clock.currentTimeMillis);
  const { history, copies } = declared;
  yield* unit.run(
    db
      .update(thread)
      .set({
        capabilities: sql`json_set(${thread.capabilities}, '$.history', ${history}, '$.copies', json(${JSON.stringify(copies)}))` as never,
        updatedAt,
      })
      .where(
        and(
          eq(thread.id, threadId),
          sql`(json_extract(${thread.capabilities}, '$.history') is not ${history}
              or json_extract(${thread.capabilities}, '$.copies.whole') is not ${copies.whole}
              or json_extract(${thread.capabilities}, '$.copies.point') is not ${copies.point})`,
        ),
      ),
  );
});

export const capabilitiesOf = (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  threadId: string,
): Effect.Effect<TransportCapabilities | undefined, StoreFailure> =>
  Effect.map(
    unit.run(db.select({ capabilities: thread.capabilities }).from(thread).where(eq(thread.id, threadId)).get()),
    (row) => row?.capabilities,
  );

export const chooseModel = Effect.fn('ThreadSeat.chooseModel')(function* (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  threadId: string,
  asked: HarnessAskedModel | undefined,
  switches: ModelSwitches | undefined,
  account: string | null | undefined,
): Effect.fn.Return<void, StoreFailure> {
  const updatedAt = new Date(yield* Clock.currentTimeMillis);
  yield* unit.run(
    db
      .update(thread)
      .set({ model: asked?.model ?? null, reasoning: asked?.reasoning ?? null, account, switches, updatedAt })
      .where(eq(thread.id, threadId)),
  );
});

export const switchesOf = (db: StoreDb<'machine'>, unit: Unit<'machine'>, threadId: string): Effect.Effect<ModelSwitches, StoreFailure> =>
  Effect.map(
    unit.run(db.select({ switches: thread.switches }).from(thread).where(eq(thread.id, threadId)).get()),
    (row) => row?.switches ?? {},
  );

export const bindingOf = (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  threadId: string,
): Effect.Effect<TransportBinding | undefined, StoreFailure> =>
  Effect.map(
    unit.run(db.select({ transport: thread.transport }).from(thread).where(eq(thread.id, threadId)).get()),
    (row) => row?.transport,
  );

export const roadOf = (db: StoreDb<'machine'>, unit: Unit<'machine'>, threadId: string): Effect.Effect<HarnessRoad, StoreFailure> =>
  Effect.flatMap(
    unit.run(
      db
        .select({
          transport: thread.transport,
          capabilities: thread.capabilities,
          provider: thread.provider,
          model: thread.model,
          reasoning: thread.reasoning,
        })
        .from(thread)
        .where(eq(thread.id, threadId))
        .get(),
    ),
    (row) => (row === undefined ? Effect.die(new Error(`Thread ${threadId} stands without its kernel row.`)) : Effect.succeed(row)),
  );

export const askedOf = (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  threadId: string,
): Effect.Effect<HarnessAskedModel | undefined, StoreFailure> =>
  Effect.map(
    unit.run(db.select({ model: thread.model, reasoning: thread.reasoning }).from(thread).where(eq(thread.id, threadId)).get()),
    (row) => (row === undefined || row.model === null ? undefined : { model: row.model, reasoning: row.reasoning }),
  );
