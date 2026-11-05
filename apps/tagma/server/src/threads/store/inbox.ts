import { Clock, Context, Effect } from 'effect';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { readableRowFact, readInboxItem } from '@runlith/agent/thread/persisted';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import {
  beforeBarrier,
  carriesWords,
  compactionHead,
  openingWords,
  opensTurn,
  type ThreadCompactionRequest,
} from '@runlith/agent/thread/inboxItems';
import { callParts, type Keyed, type TransitionOutcome } from '@runlith/agent/thread/keyed';
import { InboxConflict } from '@runlith/agent/thread/storage/inbox';
import type {
  InboxArrivalQuery,
  InboxArrivals,
  InboxFailure,
  InboxPlan,
  InboxView,
  ThreadInboxItem,
  ThreadInboxItemValues,
  ThreadInboxRequest,
  ThreadWordFate,
} from '@runlith/agent/thread/storage/inbox';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, max, ne, or, sql } from 'drizzle-orm';
import { threadRecord } from '../../thread-record/store/table.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit } from '../../platform/contract/service/units.js';
import { inboxRows, threadInbox, threadInboxWake } from './tables.js';
import { threadCall } from './calls.js';
import { inUnit, stored, trusted, type StoredFailure } from '../../platform/store/crossing.js';
import { among } from '../../platform/store/rows.js';
import { writes, type WriteSet } from '../../platform/contract/service/writes.js';
import {
  acceptanceOf,
  acknowledgeInputs,
  bindInputs,
  claimInputs,
  confirmedClaim,
  confirmInputs,
  handedInputs,
  handInputs,
  inputClaimOf,
  pendingInputs,
  readInputs,
  releaseInputs,
  reserveInputs,
  returnInputs,
  takeBackInput,
  withdrawInputs,
  type InputAcceptance,
} from './inputClaims.js';
import type { HarnessExecutionRef } from '../contract/wire/harness/observation.js';
import type { ThreadAttachmentRef } from '@runlith/agent/transcript/attachments';

const inboxing = writes('ThreadInbox.write', [inboxRows, threadInboxWake, threadCall]);

const READER_WORDS_KINDS = ['turn', 'signal'] as const;
const READER_WORDS_ROWS = 256;

type Stored<A> = Effect.Effect<A, ThreadStorageFailed>;

const prefixEnd = (prefix: string): string => `${prefix.slice(0, -1)}${String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)}`;

export class ThreadInbox extends Context.Service<
  ThreadInbox,
  {
    readonly writes: WriteSet;
    control<A>(
      threadId: string,
      plan: InboxPlan<A>,
      call: { readonly key: Keyed; readonly deadline: Date },
    ): Effect.Effect<TransitionOutcome<A>, InboxFailure>;
    put(values: ThreadInboxItemValues, tx?: Unit<'machine'>, requestDigest?: string): Stored<{ item: ThreadInboxItem; fresh: boolean }>;
    deliver(ids: readonly string[], runId: string, tx?: Unit<'machine'>): Stored<void>;
    reserveInput(
      threadId: string,
      ids: readonly string[],
      runId: string,
      execution: HarnessExecutionRef | null,
      tx?: Unit<'machine'>,
    ): Stored<readonly string[]>;
    claimInput(
      threadId: string,
      ids: readonly string[],
      runId: string,
      execution: HarnessExecutionRef | null,
      tx?: Unit<'machine'>,
    ): Stored<readonly string[]>;
    bindInput(threadId: string, runId: string, execution: HarnessExecutionRef): Stored<void>;
    confirmInput(threadId: string, runId: string, ids: readonly string[], tx?: Unit<'machine'>, settles?: boolean): Stored<void>;
    handInput(threadId: string, ids: readonly string[], runId: string, tx: Unit<'machine'>): Stored<void>;
    withdrawInput(threadId: string, ids: readonly string[], runId: string, tx: Unit<'machine'>): Stored<void>;
    releaseInput(threadId: string, runId: string, held: readonly string[], tx: Unit<'machine'>): Stored<readonly string[]>;
    takeBack(threadId: string, id: string): Stored<boolean>;
    inputAcceptance(id: string): Stored<InputAcceptance>;
    returnInput(threadId: string, ids: readonly string[], runId: string, tx?: Unit<'machine'>): Stored<void>;
    picturesOf(threadId: string, inputs: readonly string[]): Stored<readonly ThreadAttachmentRef[]>;
    inputPending(threadId: string, runId: string): Stored<readonly ThreadInboxItem[]>;
    inputHanded(threadId: string, runId: string): Stored<readonly ThreadInboxItem[]>;
    launchItems(threadId: string): Stored<{
      waiting: readonly ThreadInboxItem[];
      readable: readonly ThreadInboxItem[];
      compactions: readonly ThreadCompactionRequest[];
      carried: readonly string[];
    }>;
    acknowledge(ids: readonly string[], runId: string | null, tx?: Unit<'machine'>): Stored<void>;
    returnTo(runId: string, tx?: Unit<'machine'>): Stored<readonly string[]>;
    fated(threadId: string, runId: string, ids: readonly string[], fate: ThreadWordFate, tx: Unit<'machine'>): Stored<void>;
    acknowledgeInput(ids: readonly string[], runId: string): Stored<void>;
    readerItems(threadId: string, tx?: Unit<'machine'>): Stored<readonly ThreadInboxItem[]>;
    pending(threadId: string, tx?: Unit<'machine'>): Stored<readonly ThreadInboxItem[]>;
    pendingOf(threadIds: readonly string[], tx?: Unit<'machine'>): Stored<ReadonlyMap<string, readonly ThreadInboxItem[]>>;
    arrivals(input: InboxArrivalQuery, tx?: Unit<'machine'>): Stored<InboxArrivals>;
    unconfirmed(threadId: string, runId: string, tx?: Unit<'machine'>): Stored<readonly string[]>;
    unconfirmedOf(threadId: string, tx?: Unit<'machine'>): Stored<ReadonlyMap<string, readonly string[]>>;
    delivered(threadId: string, runId: string, tx?: Unit<'machine'>): Stored<readonly string[]>;
    readerSpoke(threadId: string, runId: string): Stored<boolean>;
    receipt(id: string, tx?: Unit<'machine'>): Stored<ThreadInboxItem | undefined>;
    intendWake(ids: readonly string[], tx?: Unit<'machine'>): Stored<void>;
    pendingWakes(limit: number, tx?: Unit<'machine'>): Stored<readonly ThreadInboxItem[]>;
    woke(ids: readonly string[], tx?: Unit<'machine'>): Stored<void>;
    openRequests(threadId: string, tx?: Unit<'machine'>): Stored<readonly ThreadInboxRequest[]>;
    openRequestsUnder(idPrefixes: readonly string[], tx?: Unit<'machine'>): Stored<readonly ThreadInboxRequest[]>;
    closeRequests(ids: readonly string[], by: string, tx?: Unit<'machine'>): Stored<readonly string[]>;
  }
>()('tagma/threads/ThreadInbox') {}

export const makeThreadInbox = Effect.gen(function* () {
  const kinds = yield* ThreadEntryKinds;
  const parseThreadInboxItem = (row: Parameters<typeof readInboxItem>[1]) => readInboxItem(kinds, row);
  const readableItems = (rows: readonly Parameters<typeof readInboxItem>[1][]): readonly ThreadInboxItem[] =>
    rows.flatMap((row) =>
      readableRowFact(
        kinds,
        row.threadId,
        'an inbox item this build cannot read is passed over, so it neither stalls its thread nor every waiting wake',
        () => [parseThreadInboxItem(row)],
        [],
        `Inbox item ${row.id} of thread ${row.threadId}`,
      ),
    );
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;

  const write = <A>(call: string, tx: Unit<'machine'> | undefined, work: (unit: Unit<'machine'>) => Effect.Effect<A, StoredFailure>) =>
    stored(call)(tx ? work(tx) : inUnit(units, inboxing, call, work));
  const read = <A>(call: string, tx: Unit<'machine'> | undefined, work: (unit: Unit<'machine'>) => Effect.Effect<A, StoredFailure>) =>
    stored(call)(tx ? work(tx) : units.read(work));
  const owedOf = (call: string, rows: readonly Parameters<typeof readInboxItem>[1][]) =>
    trusted(call, () =>
      rows
        .map((row) => parseThreadInboxItem(row))
        .filter((item): item is ThreadInboxRequest => item.kind === 'task' && item.body.intent === 'task' && item.sender.kind === 'thread'),
    );
  const ordered = (threadId: string, unit: Unit<'machine'>) =>
    unit.run(
      db
        .select()
        .from(threadInbox)
        .where(and(eq(threadInbox.threadId, threadId), ne(threadInbox.state, 'acknowledged')))
        .orderBy(asc(threadInbox.occurredAt), asc(threadInbox.seq)),
    );

  const put = (values: ThreadInboxItemValues, tx?: Unit<'machine'>, requestDigest?: string) =>
    write(
      'put',
      tx,
      Effect.fnUntraced(function* (unit) {
        const inserted = yield* unit.run(
          db
            .insert(threadInbox)
            .values({
              id: values.id,
              threadId: values.threadId,
              sender: values.sender,
              kind: values.kind,
              body: values.body,
              state: 'queued',
              requestDigest: requestDigest ?? null,
              deliveredToRunId: null,
              occurredAt: new Date(values.occurredAt),
              seq: sql`(SELECT coalesce(max(${threadInbox.seq}), 0) + 1 FROM ${threadInbox})`,
            })
            .onConflictDoNothing()
            .returning()
            .get(),
        );
        if (inserted) return { item: yield* trusted('put', () => parseThreadInboxItem(inserted)), fresh: true };
        const standing = yield* unit.run(db.select().from(threadInbox).where(eq(threadInbox.id, values.id)).get());
        if (!standing) return yield* Effect.die(new Error(`Inbox item ${values.id} vanished inside its own put.`));
        return { item: yield* trusted('put', () => parseThreadInboxItem(standing)), fresh: false };
      }),
    );

  const acknowledge = (ids: readonly string[], runId: string | null, tx?: Unit<'machine'>): Stored<void> =>
    ids.length === 0
      ? Effect.void
      : write('acknowledge', tx, (unit) =>
          Effect.asVoid(
            unit.run(
              db
                .update(threadInbox)
                .set({ state: 'acknowledged', deliveredToRunId: runId ?? undefined })
                .where(and(inArray(threadInbox.id, [...ids]), ne(threadInbox.state, 'acknowledged'))),
            ),
          ),
        );

  const receipt = (id: string, tx?: Unit<'machine'>) =>
    read('receipt', tx, (unit) =>
      Effect.flatMap(unit.run(db.select().from(threadInbox).where(eq(threadInbox.id, id)).get()), (row) =>
        row ? trusted('receipt', () => parseThreadInboxItem(row)) : Effect.succeed(undefined),
      ),
    );

  const intendWake = (ids: readonly string[], tx?: Unit<'machine'>): Stored<void> =>
    ids.length === 0
      ? Effect.void
      : write('intendWake', tx, (unit) =>
          Effect.asVoid(
            unit.run(
              db
                .insert(threadInboxWake)
                .values(ids.map((itemId) => ({ itemId })))
                .onConflictDoNothing(),
            ),
          ),
        );

  const closeRequests = Effect.fn('ThreadInbox.closeRequests')(function* (ids: readonly string[], by: string, tx?: Unit<'machine'>) {
    if (ids.length === 0) return [];
    const closedAt = new Date(yield* Clock.currentTimeMillis);
    return yield* write('closeRequests', tx, (unit) =>
      Effect.map(
        unit.run(
          db
            .update(threadInbox)
            .set({ closedAt, closedBy: by })
            .where(and(inArray(threadInbox.id, [...ids]), eq(threadInbox.kind, 'task'), isNull(threadInbox.closedAt)))
            .returning({ id: threadInbox.id }),
        ),
        (rows) => {
          const closed = new Set(rows.map((row) => row.id));
          return ids.filter((id) => closed.has(id));
        },
      ),
    );
  });

  const returnInput = (threadId: string, ids: readonly string[], runId: string, tx?: Unit<'machine'>) =>
    write('returnInput', tx, (unit) => returnInputs(db, threadId, ids, runId, unit));
  const handInput = (threadId: string, ids: readonly string[], runId: string, tx: Unit<'machine'>) =>
    stored('handInput')(handInputs(db, threadId, ids, runId, tx));
  const withdrawInput = (threadId: string, ids: readonly string[], runId: string, tx: Unit<'machine'>) =>
    stored('withdrawInput')(withdrawInputs(db, threadId, ids, runId, tx));

  const viewIn = (unit: Unit<'machine'>): InboxView => ({
    request: (requestId) =>
      stored('control.request')(
        Effect.flatMap(unit.run(db.select().from(threadInbox).where(eq(threadInbox.id, requestId)).get()), (row) =>
          row === undefined
            ? Effect.succeed(null)
            : Effect.map(
                trusted('control.request', () => parseThreadInboxItem(row)),
                (item) =>
                  item.kind !== 'task'
                    ? null
                    : {
                        request: item,
                        state:
                          row.closedAt !== null
                            ? ('closed' as const)
                            : item.deliveredToRunId === null
                              ? ('open' as const)
                              : ('taken' as const),
                        takenBy: item.deliveredToRunId,
                      },
              ),
        ),
      ),
    item: (itemId) => Effect.map(receipt(itemId, unit), (item) => item ?? null),
    newestTaken: (holderId, requesterThreadId) =>
      stored('control.newestTaken')(
        Effect.flatMap(
          unit.run(
            db
              .select()
              .from(threadInbox)
              .where(
                and(
                  eq(threadInbox.threadId, holderId),
                  eq(threadInbox.kind, 'task'),
                  isNull(threadInbox.closedAt),
                  isNotNull(threadInbox.deliveredToRunId),
                ),
              )
              .orderBy(desc(threadInbox.occurredAt), desc(threadInbox.seq)),
          ),
          (rows) =>
            trusted('control.newestTaken', () => {
              for (const row of rows) {
                const item = parseThreadInboxItem(row);
                if (
                  item.kind === 'task' &&
                  item.body.intent === 'task' &&
                  item.sender.kind === 'thread' &&
                  item.sender.threadId === requesterThreadId
                ) {
                  return item;
                }
              }
              return null;
            }),
        ),
      ),
  });

  return ThreadInbox.of({
    writes: inboxing,
    control: <A>(threadId: string, plan: InboxPlan<A>, call: { readonly key: Keyed; readonly deadline: Date }) => {
      const keyed = 'call' in call.key.evidence ? callParts(call.key.evidence.call) : null;
      return inUnit(
        units,
        inboxing,
        'control',
        Effect.fnUntraced(function* (unit) {
          yield* stored('control')(
            unit.run(db.select({ id: threadRecord.id }).from(threadRecord).where(eq(threadRecord.id, threadId)).get()),
          );
          if (keyed !== null) {
            const standing = yield* stored('control.key')(
              unit.run(
                db
                  .select({ digest: threadCall.digest, result: threadCall.result })
                  .from(threadCall)
                  .where(and(eq(threadCall.actor, keyed.actor), eq(threadCall.operation, keyed.operation), eq(threadCall.key, keyed.key)))
                  .get(),
              ),
            );
            if (standing !== undefined) {
              if (standing.digest !== call.key.digest)
                return yield* new InboxConflict({ threadId, reason: 'act-id-reused', key: call.key });
              return { replayed: (standing.result as { readonly answer: A }).answer };
            }
          }
          const decision = yield* plan.decide(viewIn(unit));
          if ('refuse' in decision) return { refused: decision.refuse };
          yield* decision.apply({
            put: (values) => put(values, unit),
            acknowledge: (ids, runId) => acknowledge(ids, runId, unit),
            closeRequests: (ids, by) => closeRequests(ids, by, unit),
            intendWake: (ids) => intendWake(ids, unit),
          });
          if (keyed !== null) {
            yield* stored('control.record')(
              unit.run(
                db.insert(threadCall).values({
                  ...keyed,
                  threadId,
                  digest: call.key.digest,
                  result: { answer: decision.result ?? null },
                  at: new Date(yield* Clock.currentTimeMillis),
                }),
              ),
            );
          }
          return { committed: decision.result };
        }),
      );
    },
    put,
    deliver: (ids, runId, tx) =>
      ids.length === 0
        ? Effect.void
        : write('deliver', tx, (unit) =>
            Effect.asVoid(
              unit.run(
                db
                  .update(threadInbox)
                  .set({ state: 'delivered', deliveredToRunId: runId })
                  .where(and(inArray(threadInbox.id, [...ids]), ne(threadInbox.state, 'acknowledged'))),
              ),
            ),
          ),
    reserveInput: (threadId, ids, runId, execution, tx) =>
      write('reserveInput', tx, (unit) => reserveInputs(db, threadId, ids, runId, execution, unit)),
    claimInput: (threadId, ids, runId, execution, tx) =>
      write('claimInput', tx, (unit) => claimInputs(db, threadId, ids, runId, execution, unit)),
    bindInput: (threadId, runId, execution) => write('bindInput', undefined, (unit) => bindInputs(db, threadId, runId, execution, unit)),
    confirmInput: (threadId, runId, ids, tx, settles = false) =>
      write('confirmInput', tx, (unit) => confirmInputs(db, threadId, runId, ids, settles, unit)),
    handInput,
    withdrawInput,
    releaseInput: (threadId, runId, held, tx) => stored('releaseInput')(releaseInputs(db, threadId, runId, held, tx)),
    takeBack: (threadId, id) => write('takeBack', undefined, (unit) => takeBackInput(db, threadId, id, unit)),
    inputAcceptance: (id) => read('inputAcceptance', undefined, (unit) => acceptanceOf(db, id, unit)),
    returnInput,
    picturesOf: (threadId, inputs) =>
      inputs.length === 0
        ? Effect.succeed([])
        : read('picturesOf', undefined, (unit) =>
            Effect.flatMap(
              unit.run(
                db
                  .select()
                  .from(threadInbox)
                  .where(and(eq(threadInbox.threadId, threadId), inArray(threadInbox.id, [...inputs])))
                  .orderBy(asc(threadInbox.occurredAt), asc(threadInbox.seq)),
              ),
              (rows) =>
                trusted('picturesOf', () =>
                  openingWords(rows.map(parseThreadInboxItem)).flatMap((item) =>
                    item.kind === 'turn' || item.kind === 'signal' ? (item.body.attachments ?? []) : [],
                  ),
                ),
            ),
          ),
    inputPending: (threadId, runId) => read('inputPending', undefined, (unit) => pendingInputs(kinds, db, threadId, runId, unit)),
    inputHanded: (threadId, runId) => read('inputHanded', undefined, (unit) => handedInputs(kinds, db, threadId, runId, unit)),
    launchItems: (threadId) =>
      read('launchItems', undefined, (unit) =>
        Effect.flatMap(ordered(threadId, unit), (rows) =>
          trusted('launchItems', () => {
            const queued = rows.filter((row) => row.state === 'queued' && row.claimId === null).map(parseThreadInboxItem);
            return {
              waiting: beforeBarrier(queued),
              readable: queued.filter((item) => carriesWords(item) && !opensTurn(item)),
              compactions: compactionHead(queued),
              carried: rows
                .filter(
                  (row) =>
                    row.state === 'delivered' &&
                    row.kind === 'task' &&
                    inputClaimOf(row.claimId) === null &&
                    (row.claimId === null || !confirmedClaim(row.claimId)),
                )
                .map((row) => row.id),
            };
          }),
        ),
      ),
    acknowledge,
    returnTo: (runId, tx) =>
      write('returnTo', tx, (unit) =>
        Effect.map(
          unit.run(
            db
              .update(threadInbox)
              .set({ state: 'queued', deliveredToRunId: null })
              .where(and(eq(threadInbox.deliveredToRunId, runId), ne(threadInbox.state, 'queued'), isNull(threadInbox.closedAt)))
              .returning({ id: threadInbox.id }),
          ),
          (rows) => rows.map((row) => row.id),
        ),
      ),
    fated: (threadId, runId, ids, fate, tx) => {
      switch (fate) {
        case 'read':
          return stored('fatedRead')(readInputs(db, threadId, runId, ids, tx));
        case 'returned':
          return returnInput(threadId, ids, runId, tx);
        case 'unconfirmed':
          return handInput(threadId, ids, runId, tx);
        case 'withdrawn':
          return withdrawInput(threadId, ids, runId, tx);
        case 'acknowledged':
          return acknowledge(ids, runId, tx);
      }
    },
    acknowledgeInput: (ids, runId) => write('acknowledgeInput', undefined, (unit) => acknowledgeInputs(db, ids, runId, unit)),
    readerItems: (threadId, tx) =>
      read('readerItems', tx, (unit) =>
        Effect.flatMap(
          unit.run(
            db
              .select()
              .from(threadInbox)
              .where(and(eq(threadInbox.threadId, threadId), inArray(threadInbox.kind, [...READER_WORDS_KINDS])))
              .orderBy(asc(threadInbox.occurredAt), asc(threadInbox.seq))
              .limit(READER_WORDS_ROWS),
          ),
          (rows) => trusted('readerItems', () => rows.map((row) => parseThreadInboxItem(row))),
        ),
      ),
    pending: (threadId, tx) => read('pending', tx, (unit) => Effect.map(ordered(threadId, unit), readableItems)),
    pendingOf: (threadIds, tx) =>
      threadIds.length === 0
        ? Effect.succeed(new Map())
        : read('pendingOf', tx, (unit) =>
            Effect.flatMap(
              unit.run(
                db
                  .select()
                  .from(threadInbox)
                  .where(and(inArray(threadInbox.threadId, among([...new Set(threadIds)])), ne(threadInbox.state, 'acknowledged')))
                  .orderBy(asc(threadInbox.occurredAt), asc(threadInbox.seq)),
              ),
              (rows) =>
                trusted('pendingOf', () => {
                  const held = new Map<string, ThreadInboxItem[]>();
                  for (const row of rows) {
                    const items = held.get(row.threadId);
                    if (items === undefined) held.set(row.threadId, [parseThreadInboxItem(row)]);
                    else items.push(parseThreadInboxItem(row));
                  }
                  return held;
                }),
            ),
          ),
    arrivals: ({ threadId, after, reports }, tx) =>
      read(
        'arrivals',
        tx,
        Effect.fnUntraced(function* (unit) {
          const highest = yield* unit.run(
            db
              .select({ through: max(threadInbox.seq) })
              .from(threadInbox)
              .where(eq(threadInbox.threadId, threadId)),
          );
          const through = highest[0]?.through ?? 0;
          const rows = yield* unit.run(
            db
              .select()
              .from(threadInbox)
              .where(
                and(
                  eq(threadInbox.threadId, threadId),
                  reports === 'all'
                    ? or(
                        ne(threadInbox.state, 'acknowledged'),
                        and(eq(threadInbox.kind, 'envelope'), sql`json_extract(${threadInbox.body}, '$.intent') = 'report'`),
                      )
                    : ne(threadInbox.state, 'acknowledged'),
                  ...(after === null ? [] : [gt(threadInbox.seq, after)]),
                  lte(threadInbox.seq, through),
                ),
              )
              .orderBy(asc(threadInbox.occurredAt), asc(threadInbox.seq)),
          );
          return yield* trusted('arrivals', () => ({
            items: rows.map((row) => parseThreadInboxItem(row)),
            through,
          }));
        }),
      ),
    unconfirmed: (threadId, runId, tx) =>
      read('unconfirmed', tx, (unit) =>
        Effect.map(
          unit.run(
            db
              .select({ id: threadInbox.id, claim: threadInbox.claimId })
              .from(threadInbox)
              .where(and(eq(threadInbox.threadId, threadId), eq(threadInbox.deliveredToRunId, runId), eq(threadInbox.state, 'delivered')))
              .orderBy(asc(threadInbox.occurredAt), asc(threadInbox.seq)),
          ),
          (rows) => rows.filter((row) => inputClaimOf(row.claim) !== null).map((row) => row.id),
        ),
      ),
    unconfirmedOf: (threadId, tx) =>
      read('unconfirmedOf', tx, (unit) =>
        Effect.map(
          unit.run(
            db
              .select({ id: threadInbox.id, claim: threadInbox.claimId, run: threadInbox.deliveredToRunId })
              .from(threadInbox)
              .where(and(eq(threadInbox.threadId, threadId), eq(threadInbox.state, 'delivered'), isNotNull(threadInbox.deliveredToRunId)))
              .orderBy(asc(threadInbox.occurredAt), asc(threadInbox.seq)),
          ),
          (rows) => {
            const held = new Map<string, string[]>();
            for (const row of rows) {
              if (row.run === null || inputClaimOf(row.claim) === null) continue;
              const ids = held.get(row.run);
              if (ids === undefined) held.set(row.run, [row.id]);
              else ids.push(row.id);
            }
            return held as ReadonlyMap<string, readonly string[]>;
          },
        ),
      ),
    delivered: (threadId, runId, tx) =>
      read('delivered', tx, (unit) =>
        Effect.map(
          unit.run(
            db
              .select({ id: threadInbox.id })
              .from(threadInbox)
              .where(and(eq(threadInbox.threadId, threadId), eq(threadInbox.deliveredToRunId, runId)))
              .orderBy(asc(threadInbox.occurredAt), asc(threadInbox.seq)),
          ),
          (rows) => rows.map((row) => row.id),
        ),
      ),
    readerSpoke: (threadId, runId) =>
      read('readerSpoke', undefined, (unit) =>
        Effect.map(
          unit.run(
            db
              .select({ id: threadInbox.id })
              .from(threadInbox)
              .where(
                and(
                  eq(threadInbox.threadId, threadId),
                  eq(threadInbox.deliveredToRunId, runId),
                  sql`json_extract(${threadInbox.sender}, '$.kind') = 'reader'`,
                ),
              )
              .limit(1),
          ),
          (rows) => rows.length > 0,
        ),
      ),
    receipt,
    intendWake,
    pendingWakes: (limit, tx) =>
      read('pendingWakes', tx, (unit) =>
        Effect.flatMap(
          unit.run(
            db
              .select({ item: threadInbox })
              .from(threadInboxWake)
              .innerJoin(threadInbox, eq(threadInbox.id, threadInboxWake.itemId))
              .orderBy(asc(threadInboxWake.at), asc(threadInboxWake.itemId))
              .limit(limit),
          ),
          (rows) => Effect.succeed(readableItems(rows.map((row) => row.item))),
        ),
      ),
    woke: (ids, tx) =>
      ids.length === 0
        ? Effect.void
        : write('woke', tx, (unit) => Effect.asVoid(unit.run(db.delete(threadInboxWake).where(inArray(threadInboxWake.itemId, [...ids]))))),
    openRequests: (threadId, tx) =>
      read('openRequests', tx, (unit) =>
        Effect.flatMap(
          unit.run(
            db
              .select()
              .from(threadInbox)
              .where(and(eq(threadInbox.threadId, threadId), eq(threadInbox.kind, 'task'), isNull(threadInbox.closedAt)))
              .orderBy(asc(threadInbox.occurredAt), asc(threadInbox.seq)),
          ),
          (rows) => owedOf('openRequests', rows),
        ),
      ),
    openRequestsUnder: (idPrefixes, tx) =>
      idPrefixes.length === 0
        ? Effect.succeed([])
        : read('openRequestsUnder', tx, (unit) =>
            Effect.flatMap(
              unit.run(
                db
                  .select()
                  .from(threadInbox)
                  .where(
                    and(
                      or(...idPrefixes.map((prefix) => and(gte(threadInbox.id, prefix), lt(threadInbox.id, prefixEnd(prefix))))),
                      eq(threadInbox.kind, 'task'),
                      isNull(threadInbox.closedAt),
                    ),
                  )
                  .orderBy(asc(threadInbox.occurredAt), asc(threadInbox.seq)),
              ),
              (rows) => owedOf('openRequestsUnder', rows),
            ),
          ),
    closeRequests,
  });
});
