import { declare } from '@runlith/held/Held';
import { Context, Duration, Effect, Queue, Stream, type Cause } from 'effect';
import type { ListenerReport } from '@runlith/executions/protocol/evidence';
import type { InventoryFeedItem } from '@runlith/executions/protocol/inventory';
import type { ExecutionState, ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import type { Executions } from '@runlith/executions/Executions';
import type { ExecutionFeed } from '@runlith/executions/ExecutionFeed';
import type { ExecutionEvidence } from '@runlith/executions/ExecutionEvidence';
import type { HostLifecycle } from '@runlith/executions/HostLifecycle';
import { executionWireLimits } from '../host/policy.js';
import { executionHandshakeMs } from '../contract/wire/terminalBehavior.js';
import type { TerminalFailure } from '../contract/service/terminals.js';
import { TerminalUnavailable } from '../contract/wire/refusals.js';
import { INVENTORY_PAGE } from '../store/terminalRows.js';

export type HeldReading = {
  readonly stateOf: (ref: ExecutionRef) => ExecutionState | undefined;
  readonly printed: (ref: ExecutionRef) => boolean | undefined;
  readonly whole: boolean;
};

export type CellReading = HeldReading & {
  readonly listeners: ListenerReport | undefined;
  readonly stale: boolean;
};

export type InventoryMoves = {
  readonly epoch: number;
  readonly revision: number | undefined;
  readonly horizon: number;
  readonly movedAfter: (execution: string, revision: number) => boolean;
  readonly holds: (ref: ExecutionRef) => boolean;
};

const MOVES_KEPT = 8 * INVENTORY_PAGE;

type Mirrored = { readonly state: ExecutionState; readonly printed: boolean | undefined };

const mirroredOf = (summary: ExecutionSummary): Mirrored => ({ state: summary.state, printed: summary.printed });

type Cell = {
  listeners: ListenerReport | undefined;
  refreshing: boolean;
};

const UNREAD: InventoryFeedItem = { _tag: 'Gap', revision: 0, detail: 'the host inventory has not been read yet' };

export type TerminalInventory = Effect.Success<ReturnType<typeof makeTerminalInventory>>;

export const TerminalInventory = Context.Service<TerminalInventory>('tagma/executions/TerminalInventory');

export const makeTerminalInventory = Effect.fnUntraced(function* ({
  executions,
}: {
  readonly executions: Executions['Service'] & ExecutionFeed['Service'] & ExecutionEvidence['Service'] & HostLifecycle['Service'];
}) {
  const scope = yield* Effect.scope;
  const cells = new Map<number, Cell>();
  const flight = declare<string>({
    name: 'executions/inventory-flight',
    owner: 'executions',
    rank: 600,
    key: (key) => key,
    concurrency: 1,
    threshold: '5 seconds',
    ceilings: { hold: '2 minutes', wait: '2 minutes', leaves: 'the mirror keeps its last reading; the next refresh reads the host again' },
    external: { named: 'execution host', callsBack: false },
  });
  const readers = new Set<Queue.Queue<InventoryFeedItem, Cause.Done>>();
  const mirror = new Map<string, Mirrored>();
  const moved = new Map<string, number>();
  let epoch = 0;
  let horizon = 0;
  let wanted = false;
  let synced: number | undefined;
  let generation: number | undefined;
  let latest: InventoryFeedItem | undefined;

  const mirrored = (ref: ExecutionRef): Mirrored | undefined => {
    const held = mirror.get(ref.execution);
    return held !== undefined && held.state.ref.incarnation === ref.incarnation && held.state.ref.installation === ref.installation
      ? held
      : undefined;
  };

  const reading = (): HeldReading => ({
    stateOf: (ref) => mirrored(ref)?.state,
    printed: (ref) => mirrored(ref)?.printed,
    whole: synced !== undefined,
  });

  const forgetMoves = (): void => {
    epoch += 1;
    horizon = 0;
    moved.clear();
  };

  const prune = (): void => {
    const stamps = [...moved.values()].sort((left, right) => left - right);
    const cut = stamps[Math.floor(stamps.length / 2)] as number;
    for (const [execution, stamp] of moved) if (stamp <= cut) moved.delete(execution);
    horizon = Math.max(horizon, cut);
  };

  const lost = (): void => {
    synced = undefined;
    forgetMoves();
  };

  const unread = (step: string, failure: { readonly _tag: string }) =>
    Effect.andThen(
      Effect.sync(lost),
      Effect.logDebug(`the host inventory ${step} could not be read; the mirror is read again`, { reason: failure._tag }),
    );

  const serial = <A, R>(work: Effect.Effect<A, never, R>): Effect.Effect<A, TerminalUnavailable, R> =>
    flight.hold('inventory', work).pipe(Effect.mapError((held) => new TerminalUnavailable({ owner: 'host', message: held.message })));

  const behind = (): boolean => synced === undefined || latest === undefined || latest._tag === 'Gap' || latest.revision > synced;

  const publish = (update: InventoryFeedItem): void => {
    latest = update;
    for (const reader of readers) Queue.offerUnsafe(reader, update);
  };

  const sameGeneration = Effect.fnUntraced(function* () {
    const standing = yield* Effect.result(executions.generation());
    if (standing._tag === 'Failure') {
      yield* Effect.logDebug('the host generation could not be read again; the reading taken is dropped', {
        reason: standing.failure._tag,
      });
      return false;
    }
    return standing.success === generation;
  });

  const whole = Effect.fnUntraced(function* () {
    const summaries: ExecutionSummary[] = [];
    let after: ExecutionRef | undefined;
    for (;;) {
      const page = yield* executions.list({ after: after, limit: INVENTORY_PAGE }).pipe(Effect.withSpan('TerminalInventory.walk.page'));
      summaries.push(...page.executions);
      if (page.after === undefined) return summaries;
      after = page.after;
    }
  });

  const catchUp = Effect.fnUntraced(function* () {
    const standing = yield* Effect.result(executions.generation());
    if (standing._tag === 'Failure') return yield* unread('generation', standing.failure);
    if (standing.success !== generation) {
      mirror.clear();
      lost();
      generation = standing.success;
    }
    const asked = yield* Effect.result(executions.changes(synced ?? 0, INVENTORY_PAGE).pipe(Effect.withSpan('TerminalInventory.changes')));
    if (asked._tag === 'Failure') return yield* unread('changes', asked.failure);
    if (!(yield* sameGeneration())) return lost();
    const answer = asked.success;
    if (answer._tag === 'Changed') {
      for (const summary of answer.executions) {
        mirror.set(summary.state.ref.execution, mirroredOf(summary));
        moved.set(summary.state.ref.execution, answer.revision);
      }
      for (const ref of answer.left) {
        mirror.delete(ref.execution);
        moved.set(ref.execution, answer.revision);
      }
      if (moved.size > MOVES_KEPT) prune();
      synced = answer.revision;
      return;
    }
    forgetMoves();
    const walked = yield* Effect.result(whole());
    if (walked._tag === 'Failure') return yield* unread('listing', walked.failure);
    if (!(yield* sameGeneration())) return lost();
    mirror.clear();
    for (const summary of walked.success) mirror.set(summary.state.ref.execution, mirroredOf(summary));
    synced = answer.revision;
  });

  const heard = (): Effect.Effect<ListenerReport | undefined> =>
    Effect.flatMap(Effect.result(executions.hostListeners()), (listeners) =>
      listeners._tag === 'Success'
        ? Effect.succeed(listeners.success)
        : Effect.as(
            Effect.logWarning('the host listeners could not be read, so the terminals carry no listener reading', {
              failure: listeners.failure,
            }),
            undefined,
          ),
    );

  const take = Effect.fnUntraced(function* () {
    if (cells.size === 0) return;
    yield* catchUp();
    const listeners = yield* heard();
    const known = synced !== undefined;
    for (const cell of cells.values()) {
      cell.listeners = listeners;
      cell.refreshing = !known || listeners === undefined;
    }
  });

  const listen = Effect.fnUntraced(function* () {
    if (cells.size === 0) return;
    const listeners = yield* heard();
    for (const cell of cells.values()) {
      cell.listeners = listeners;
      if (listeners === undefined) cell.refreshing = true;
    }
  });

  const took = (update: InventoryFeedItem): Effect.Effect<void, TerminalUnavailable> =>
    serial(
      Effect.gen(function* () {
        if (update._tag === 'Gap' || synced === undefined || update.revision > synced) {
          for (const cell of cells.values()) cell.refreshing = true;
          yield* take();
        } else {
          yield* listen();
        }
        publish(update);
      }),
    );

  const refresh = Effect.fnUntraced(function* () {
    wanted = true;
    for (const cell of cells.values()) cell.refreshing = true;
    const read = yield* Effect.result(
      serial(
        Effect.gen(function* () {
          while (wanted) {
            wanted = false;
            yield* take();
          }
        }),
      ),
    );
    if (read._tag === 'Failure') {
      wanted = false;
      yield* Effect.logWarning('the host inventory was not read again; the terminals keep their last reading, marked stale', {
        reason: read.failure.message,
      });
    }
  });

  const subscribed = (): Stream.Stream<InventoryFeedItem, TerminalFailure> =>
    executions.subscribe({ _tag: 'Inventory' }, executionWireLimits.credits).pipe(
      Stream.map((delivery) => (delivery._tag === 'Inventory' ? delivery.update : null)),
      Stream.filter((update): update is InventoryFeedItem => update !== null),
    );

  return {
    of: Effect.fnUntraced(function* (projectId: number) {
      let cell = cells.get(projectId);
      if (cell === undefined) {
        cell = { listeners: undefined, refreshing: true };
        cells.set(projectId, cell);
        yield* Effect.forkIn(refresh(), scope);
      }
      const read = reading();
      return { ...read, listeners: cell.listeners, stale: cell.refreshing || !read.whole } satisfies CellReading;
    }),
    retained: (projectId: number): CellReading | undefined => {
      const cell = cells.get(projectId);
      if (cell === undefined) return undefined;
      const read = reading();
      return { ...read, listeners: cell.listeners, stale: cell.refreshing || !read.whole };
    },
    held: (fresh: boolean): Effect.Effect<HeldReading, TerminalUnavailable> =>
      serial(
        Effect.gen(function* () {
          if (fresh || behind()) yield* catchUp();
          return reading();
        }),
      ),
    invalidate: Effect.fnUntraced(function* (projectId: number) {
      const cell = cells.get(projectId);
      if (cell !== undefined) cell.refreshing = true;
      const owed = wanted;
      wanted = true;
      if (owed) return;
      yield* Effect.forkIn(refresh(), scope);
    }),
    forget: (projectId: number): void => {
      cells.delete(projectId);
    },
    moves: (): Effect.Effect<InventoryMoves, TerminalUnavailable> =>
      serial(
        Effect.gen(function* () {
          if (behind()) yield* catchUp();
          const at = epoch;
          const read = reading();
          return {
            epoch: at,
            revision: synced,
            horizon,
            movedAfter: (execution: string, revision: number) =>
              epoch !== at || revision < horizon || (moved.get(execution) ?? -1) > revision,
            holds: (ref: ExecutionRef) => read.stateOf(ref) !== undefined,
          };
        }),
      ),
    refresh,
    changes: (): Stream.Stream<InventoryFeedItem> =>
      Stream.callback<InventoryFeedItem>(
        (reader) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              readers.add(reader);
              Queue.offerUnsafe(reader, latest ?? UNREAD);
            }),
            () => Effect.sync(() => void readers.delete(reader)),
          ),
        { bufferSize: 1, strategy: 'sliding' },
      ),
    follow: (): Effect.Effect<never> =>
      Effect.forever(
        Effect.gen(function* () {
          let delivered = false;
          const followed = yield* Effect.result(
            Stream.runForEach(subscribed(), (update) => {
              delivered = true;
              return took(update);
            }),
          );
          if (followed._tag === 'Failure') {
            yield* Effect.logWarning('the host inventory feed could not be followed; the cell stands until it can', {
              reason: followed.failure._tag,
            });
          }
          lost();
          if (delivered) {
            publish({
              _tag: 'Gap',
              revision: latest?.revision ?? 0,
              detail: 'the host inventory feed ended; it is followed again once the host answers',
            });
          }
          yield* Effect.sleep(Duration.millis(executionHandshakeMs));
        }),
      ),
  };
});
