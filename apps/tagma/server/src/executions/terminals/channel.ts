import { Effect, Queue, Stream } from 'effect';
import type { Rpc } from 'effect/rpc';
import { BindingId } from '@runlith/executions/protocol/custody';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import { refusing } from '../../platform/contract/service/body.js';
import { GateRefusal, type RefusalBody } from '../../platform/contract/wire/refusal.js';
import type {
  TerminalBytesSubscription,
  TerminalDecider,
  TerminalGridReport,
  TerminalGridSubscription,
  TerminalLaneHeld,
  TerminalLaneHold,
  TerminalScreenDelivery,
  TerminalScreenPainted,
  TerminalScreenPoint,
  TerminalScreenPointRead,
  TerminalScreenSubscription,
  ViewLeaseId,
} from '../contract/wire/viewLeases.js';
import type { RecordParsed } from '../contract/wire/viewLeases.js';
import { TerminalRefused } from '../contract/wire/refusals.js';
import { gatedRecords, gatedScreens } from './viewLeases.js';
import type { RecordChunk, RecordDelivery } from '../contract/wire/viewLeases.js';
import { terminalRefusal } from './refusal.js';
import type { ExecutionRecords, TerminalScreens } from '../contract/service/records.js';
import type { Terminals } from '../contract/service/terminals.js';
import type { TerminalGrids, ViewLanes, ViewLeases } from '../contract/service/views.js';

const HELD: TerminalLaneHeld = { held: true };

export const terminalChannel = (use: {
  readonly terminals: Terminals['Service'];
  readonly screens: TerminalScreens['Service'];
  readonly records: ExecutionRecords['Service'];
  readonly viewers: ViewLeases['Service'];
  readonly lanes: ViewLanes['Service'];
  readonly grids: TerminalGrids['Service'];
}) => {
  return {
    'terminal.screen.subscribe': (
      params: TerminalScreenSubscription,
      call: { readonly client: Rpc.ServerClient },
    ): Stream.Stream<TerminalScreenDelivery, RefusalBody> =>
      spelled(
        Stream.unwrap(
          Effect.gen(function* () {
            yield* Effect.annotateCurrentSpan({ execution: params.execution, incarnation: params.incarnation });
            const record = yield* placed(use.terminals, params, 'screen');
            const viewer = yield* seat(use.viewers, call.client.id, record.execution, 'screen', 'screen');
            return Stream.map(
              gatedScreens(
                use.viewers,
                viewer,
                use.screens.screens(record.execution, params.base).pipe(Stream.mapError(asRefusal('screen'))),
              ),
              (update) => ({ viewer, update }),
            );
          }),
        ),
      ),

    'terminal.screen.painted': (
      params: TerminalScreenPainted,
      call: { readonly client: Rpc.ServerClient },
    ): Effect.Effect<{ readonly acknowledged: true }, RefusalBody> =>
      Effect.tap(
        refusing(
          use.viewers
            .acknowledged(call.client.id, params.viewer, params.revision)
            .pipe(Effect.mapError(leaseRefusal('screen')), Effect.as({ acknowledged: true as const })),
        ),
        () => Effect.annotateCurrentSpan({ revision: params.revision }),
      ),

    'terminal.screen.point': (params: TerminalScreenPointRead): Effect.Effect<TerminalScreenPoint, RefusalBody> =>
      refusing(
        Effect.gen(function* () {
          yield* Effect.annotateCurrentSpan({ execution: params.execution, incarnation: params.incarnation });
          const record = yield* placed(use.terminals, params, 'screen');
          return yield* use.screens.point(record.execution, { scrollback: params.scrollback }).pipe(Effect.mapError(asRefusal('screen')));
        }),
      ),

    'terminal.bytes.subscribe': (
      params: TerminalBytesSubscription,
      call: { readonly client: Rpc.ServerClient },
    ): Stream.Stream<RecordDelivery, RefusalBody> =>
      spelled(
        Stream.unwrap(
          Effect.gen(function* () {
            yield* Effect.annotateCurrentSpan({
              execution: params.execution,
              incarnation: params.incarnation,
              offset: params.offset,
            });
            const record = yield* placed(use.terminals, params, 'record');
            const viewer = yield* seat(use.viewers, call.client.id, record.execution, params.stream, 'record');
            return Stream.map(
              gatedRecords(
                use.viewers,
                viewer,
                use.records
                  .records({ ref: record.execution, stream: params.stream, offset: params.offset })
                  .pipe(Stream.mapError(asRefusal('record'))),
              ),
              (chunk) => ({ viewer, chunk: encoded(chunk) }),
            );
          }),
        ),
      ),

    'terminal.bytes.parsed': (
      params: RecordParsed,
      call: { readonly client: Rpc.ServerClient },
    ): Effect.Effect<{ readonly acknowledged: true }, RefusalBody> =>
      refusing(
        use.viewers
          .acknowledged(call.client.id, params.viewer, params.offset)
          .pipe(Effect.mapError(leaseRefusal('record')), Effect.as({ acknowledged: true as const })),
      ),

    'terminal.lane.hold': (params: TerminalLaneHold): Stream.Stream<TerminalLaneHeld, RefusalBody> =>
      spelled(
        Stream.unwrap(
          Effect.gen(function* () {
            yield* Effect.annotateCurrentSpan({ execution: params.execution, incarnation: params.incarnation });
            const record = yield* placed(use.terminals, params, 'lane');
            yield* use.lanes.hold(record.execution, BindingId.make(params.binding));
            return Stream.concat(Stream.succeed(HELD), Stream.never);
          }),
        ),
      ),

    'terminal.grid.subscribe': (
      params: TerminalGridSubscription,
      call: { readonly client: Rpc.ServerClient },
    ): Stream.Stream<TerminalDecider, RefusalBody> =>
      spelled(
        Stream.unwrap(
          Effect.gen(function* () {
            yield* Effect.annotateCurrentSpan({ execution: params.execution, incarnation: params.incarnation, view: params.view });
            const record = yield* placed(use.terminals, params, 'grid');
            return Stream.callback<TerminalDecider>(
              (queue) =>
                use.grids.watch(record.execution, params.view, call.client.id, params.box, (decider) => {
                  Queue.offerUnsafe(queue, decider);
                }),
              { bufferSize: GRID_FRAMES, strategy: 'sliding' },
            );
          }),
        ),
      ),

    'terminal.grid.report': (
      params: TerminalGridReport,
      call: { readonly client: Rpc.ServerClient },
    ): Effect.Effect<{ readonly acknowledged: true }, RefusalBody> =>
      refusing(
        Effect.gen(function* () {
          yield* Effect.annotateCurrentSpan({
            execution: params.execution,
            view: params.view,
            rows: params.box.rows,
            columns: params.box.columns,
          });
          const record = yield* placed(use.terminals, params, 'grid');
          const seen = yield* use.grids.report(record.execution, params.view, call.client.id, params.box);
          if (!seen) {
            return yield* new GateRefusal(
              'terminal-view-unknown',
              `view ${params.view} holds no grid subscription on this connection, so its box decides nothing`,
              ['subscribe the view’s grid on this connection, then report its box'],
            );
          }
          return { acknowledged: true as const };
        }),
      ),
  };
};

const GRID_FRAMES = 4;

type Feed = 'screen' | 'record' | 'lane' | 'grid';

const placed = Effect.fnUntraced(function* (
  terminals: Terminals['Service'],
  params: { readonly projectId: number; readonly execution: string; readonly incarnation: number },
  feed: Feed,
) {
  const record = yield* terminals.record(params.execution, params.incarnation).pipe(Effect.mapError(asRefusal(feed)));
  if (record === null || record.projectId !== params.projectId) {
    return yield* new GateRefusal(
      'terminal-unknown',
      `this installation holds no projection of execution ${params.execution} in this project`,
      ['read this project’s terminal inventory', 'name the project the execution belongs to'],
    );
  }
  return record;
});

const seat = (
  viewers: ViewLeases['Service'],
  connection: number,
  execution: Parameters<ViewLeases['Service']['open']>[1],
  source: Parameters<ViewLeases['Service']['open']>[2],
  feed: Feed,
): Effect.Effect<ViewLeaseId, GateRefusal, import('effect').Scope.Scope> =>
  Effect.acquireRelease(
    Effect.withSpan('ViewLeaseBook.open', { attributes: { feed, source } })(
      viewers.open(connection, execution, source).pipe(Effect.mapError(asRefusal(feed))),
    ),
    (held) => viewers.close(held),
  );

const encoded = (chunk: RecordChunk) =>
  chunk._tag === 'Ended'
    ? ({ _tag: 'Ended', ending: chunk.ending } as const)
    : ({ _tag: 'Bytes', range: chunk.range, bytes: chunk.bytes } as const);

const spelled = <A>(stream: Stream.Stream<A, GateRefusal>): Stream.Stream<A, RefusalBody> =>
  Stream.catchIf(
    stream,
    (failure): failure is GateRefusal => failure instanceof GateRefusal,
    (gate) => Stream.fromEffect(refusing(Effect.fail(gate))),
  );

const asRefusal =
  (feed: Feed) =>
  (failure: unknown): GateRefusal => {
    if (failure instanceof GateRefusal) return failure;
    if (failure instanceof TerminalRefused) return terminalRefusal(failure);
    if (isWireFailure(failure)) return terminalRefusal(failure);
    return new GateRefusal(
      `terminal-${feed}-${tagOf(failure)}`,
      feed === 'screen'
        ? 'the interpreted screen of this execution could not be followed'
        : feed === 'grid'
          ? 'the grid of this execution could not be followed'
          : feed === 'lane'
            ? 'the lane into this execution could not be held'
            : 'the byte record of this execution could not be followed',
      ['reopen the view: a reader is released with its stream and nothing is held for it'],
    );
  };

const leaseRefusal =
  (feed: Feed) =>
  (failure: unknown): GateRefusal =>
    failure instanceof TerminalRefused
      ? new GateRefusal(`terminal-${feed}-lease-closed`, failure.message, [
          'open the view again: a reader is released with its stream and nothing is held for it',
        ])
      : asRefusal(feed)(failure);

const WIRE_FAILURES = new Set(['HostRefused', 'WireLost', 'WireInvalid', 'WireUnreadable', 'WireFailed', 'WireUnavailable']);
const isWireFailure = (failure: unknown): failure is ExecutionsFailure =>
  typeof failure === 'object' &&
  failure !== null &&
  '_tag' in failure &&
  typeof failure._tag === 'string' &&
  WIRE_FAILURES.has(failure._tag);

const tagOf = (failure: unknown): string =>
  typeof failure === 'object' && failure !== null && '_tag' in failure && typeof failure._tag === 'string' ? failure._tag : 'unavailable';
