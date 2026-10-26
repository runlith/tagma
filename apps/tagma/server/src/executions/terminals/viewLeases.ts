import { randomUUID } from 'node:crypto';
import { waiters } from '@runlith/held/Waiters';
import { Cause, Effect, Exit, Stream } from 'effect';
import { ViewLeases } from '../contract/service/views.js';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ScreenFeedItem } from '@runlith/executions/protocol/presentation';
import { offsetValue, type ByteOffset } from '@runlith/executions/protocol/record';
import { TerminalRefused } from '../contract/wire/refusals.js';
import { ViewLeaseId, type DeliveryMark, type RecordChunk, type ViewerSource } from '../contract/wire/viewLeases.js';
import { executionRecordWindow } from '../host/policy.js';

const recordWindow = (mark: DeliveryMark): boolean => typeof mark === 'string';

export const LIVE_VIEWERS = 256;

type Lease = {
  readonly connection: number;
  readonly execution: ExecutionRef;
  readonly source: ViewerSource;
  handed: Set<DeliveryMark>;
};

const markKey = (viewer: ViewLeaseId, mark: DeliveryMark): string => `${viewer}#${mark}`;

export type ViewLeaseBook = ViewLeases['Service'] & { readonly held: number };

export const makeViewLeaseBook = Effect.fnUntraced(function* (options: { readonly capacity?: number; readonly window?: number } = {}) {
  const leases = new Map<ViewLeaseId, Lease>();
  const turns = yield* waiters<string, void, never>({ name: 'executions/view-lease-marks', owner: 'executions', key: (key) => key });
  const capacity = options.capacity ?? LIVE_VIEWERS;
  const window = options.window ?? executionRecordWindow;

  return {
    get held() {
      return leases.size;
    },
    ...ViewLeases.of({
      open: Effect.fnUntraced(function* (connection: number, execution: ExecutionRef, source: ViewerSource) {
        if (leases.size >= capacity) {
          return yield* new TerminalRefused({
            reason: 'capacity',
            message: `This process holds its ceiling of ${capacity} open live views; a further view refuses rather than displacing one.`,
          });
        }
        const id = ViewLeaseId.make(`viewer:${randomUUID()}`);
        leases.set(id, { connection, execution, source, handed: new Set() });
        return id;
      }),
      ready: (viewer) =>
        Effect.suspend(() => {
          const lease = leases.get(viewer);
          if (lease === undefined) return Effect.succeed(false);
          const oldest = lease.handed.values().next();
          if (oldest.done === true) return Effect.succeed(true);
          const firstMark = oldest.value;
          if (recordWindow(firstMark) && lease.handed.size < window) return Effect.succeed(true);
          const key = markKey(viewer, firstMark);
          const stillHanded = Effect.sync(() => {
            if (!lease.handed.has(firstMark)) turns.complete(key, Exit.void);
          });
          return Effect.map(turns.wait(key, stillHanded), () => leases.has(viewer)).pipe(Effect.withSpan('ViewLeaseBook.ready'));
        }),
      handing: Effect.fnUntraced(function* (viewer: ViewLeaseId, mark: DeliveryMark) {
        const lease = leases.get(viewer);
        if (lease === undefined || lease.handed.has(mark)) return false;
        const full = recordWindow(mark) ? lease.handed.size >= window : lease.handed.size > 0;
        if (full) return false;
        lease.handed.add(mark);
        return true;
      }),
      acknowledged: Effect.fn('ViewLeaseBook.acknowledged')(function* (connection, viewer, mark) {
        const lease = leases.get(viewer);
        if (lease === undefined) {
          return yield* new TerminalRefused({
            reason: 'stale',
            message: 'This view’s lease is closed; its reader was released with its stream.',
          });
        }
        if (lease.connection !== connection) {
          return yield* new TerminalRefused({
            reason: 'not-holder',
            message: 'This lease belongs to another connection; an acknowledgement is admitted only on its own.',
          });
        }
        if (!lease.handed.has(mark)) return;
        for (const held of lease.handed) {
          const released =
            recordWindow(mark) && recordWindow(held) ? offsetValue(held as ByteOffset) <= offsetValue(mark as ByteOffset) : held === mark;
          if (!released) continue;
          lease.handed.delete(held);
          turns.complete(markKey(viewer, held), Exit.void);
        }
      }),
      close: Effect.fnUntraced(function* (viewer: ViewLeaseId) {
        const lease = leases.get(viewer);
        if (lease === undefined) return;
        leases.delete(viewer);
        for (const mark of lease.handed) turns.complete(markKey(viewer, mark), Exit.void);
      }),
    }),
  } satisfies ViewLeaseBook;
});

export const gatedScreens = <E>(
  viewers: ViewLeases['Service'],
  viewer: ViewLeaseId,
  source: Stream.Stream<ScreenFeedItem, E>,
): Stream.Stream<ScreenFeedItem, E> =>
  gated(viewers, viewer, source, (update) => (update._tag === 'ScreenUnavailable' ? null : update.provenance.revision));

export const gatedRecords = <E>(
  viewers: ViewLeases['Service'],
  viewer: ViewLeaseId,
  source: Stream.Stream<RecordChunk, E>,
): Stream.Stream<RecordChunk, E> =>
  gated(viewers, viewer, source, (chunk) => (chunk._tag === 'Ended' ? null : chunk.bytes.length === 0 ? UNGATED : chunk.range.next));

const UNGATED = Symbol('ungated');

const gated = <A, E>(
  viewers: ViewLeases['Service'],
  viewer: ViewLeaseId,
  source: Stream.Stream<A, E>,
  mark: (item: A) => DeliveryMark | typeof UNGATED | null,
): Stream.Stream<A, E> =>
  Stream.transformPull(source, (pull) =>
    Effect.sync(() => {
      let answered: readonly A[] = [];
      let handed = 0;
      let ended = false;
      const step: Effect.Effect<readonly [A], E | Cause.Done<void>> = Effect.suspend(function next(): Effect.Effect<
        readonly [A],
        E | Cause.Done<void>
      > {
        if (ended) return Cause.done();
        return Effect.flatMap(viewers.ready(viewer), (standing) => {
          if (!standing) return Cause.done();
          if (handed >= answered.length) {
            return Effect.flatMap(pull, (chunk) => {
              answered = chunk;
              handed = 0;
              return next();
            });
          }
          const item = answered[handed++] as A;
          const waited = mark(item);
          if (waited === null) {
            ended = true;
            return Effect.succeed([item] as const);
          }
          if (waited === UNGATED) return Effect.succeed([item] as const);
          return Effect.flatMap(viewers.handing(viewer, waited), (armed) => (armed ? Effect.succeed([item] as const) : Cause.done<void>()));
        });
      });
      return step;
    }),
  );
