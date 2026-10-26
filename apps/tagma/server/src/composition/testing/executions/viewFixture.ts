import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { kind, world } from '@runlith/testbed/worlds';
import { type Cause, Context, Effect, Exit, type FileSystem, Layer, Predicate, Queue, Schedule, Schema, Scope, Stream } from 'effect';
import { RpcClient, type RpcClientError, type RpcGroup } from 'effect/rpc';
import { Socket } from 'effect/socket';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InputAnswer } from '@runlith/executions/protocol/input';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { makePageWorld } from '../pageWorld.js';
import { liveSerialization } from '../../../platform/contract/wire/live.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { TAGMA_SOCKET_PATH } from '../../../socket/rpc.js';
import { LiveRpc } from '../../rpc.js';
import { LANE_OPERATIONS } from '../../../executions/contract/wire/operations/lanes.js';
import {
  TerminalBytesReading,
  TerminalOperationReading,
  TerminalScreenReading,
} from '../../../executions/contract/wire/operationAnswers.js';
import {
  TerminalLaneOpened,
  type TerminalBox,
  type TerminalDecider,
  type TerminalGridReport,
  type TerminalGridSubscription,
  ViewId,
  type ViewInputCause,
} from '../../../executions/contract/wire/viewLeases.js';

export const address = (execution: ExecutionRef) => ({ execution: execution.execution, incarnation: execution.incarnation });

export const settles = <A, E, R>(read: Effect.Effect<A, E, R>, done: (value: A) => boolean) =>
  Effect.repeat(read, { until: done, schedule: Schedule.spaced('25 millis') });

export const nextDecider = <E>(queue: Queue.Dequeue<TerminalDecider, E>, decider: TerminalDecider['decider']) =>
  Effect.repeat(Queue.take(queue), { until: (frame) => frame.decider === decider });

type LiveClient = RpcClient.RpcClient<RpcGroup.Rpcs<typeof LiveRpc>, RpcClientError.RpcClientError>;
type Page = Effect.Success<ReturnType<typeof makePageWorld>>;
type ViewWindow = {
  readonly client: LiveClient;
  readonly listen: <A, E>(stream: Stream.Stream<A, E>) => Effect.Effect<Queue.Dequeue<A, E | Cause.Done>>;
  readonly heard: (execution: ExecutionRef, view: string, box: TerminalBox) => Effect.Effect<unknown, unknown>;
  readonly close: Effect.Effect<void>;
};
type ViewFixtureShape = Page & {
  readonly operationId: () => string;
  readonly started: (label: string) => Effect.Effect<ExecutionRef, unknown, Scope.Scope>;
  readonly opened: (execution: ExecutionRef, view: string) => Effect.Effect<TerminalLaneOpened, unknown>;
  readonly typed: (
    execution: ExecutionRef,
    lane: TerminalLaneOpened,
    sequence: number,
    text: string,
    cause?: ViewInputCause,
  ) => Effect.Effect<InputAnswer, unknown>;
  readonly echoed: (execution: ExecutionRef, want: readonly string[], stream?: 'pty' | 'stdout') => Effect.Effect<string, unknown>;
  readonly gridOf: (execution: ExecutionRef) => Effect.Effect<TerminalBox | null, unknown>;
  readonly grid: (execution: ExecutionRef, view: string, box: TerminalBox | undefined) => TerminalGridSubscription;
  readonly report: (execution: ExecutionRef, view: string, box: TerminalBox) => TerminalGridReport;
  readonly window: () => Effect.Effect<ViewWindow, never, Scope.Scope>;
};

export class ViewFixture extends Context.Service<ViewFixture, ViewFixtureShape>()('testing/executions/ViewFixture') {}

const makeViewFixture: Effect.Effect<ViewFixtureShape, unknown, FileSystem.FileSystem | Scope.Scope> = Effect.gen(function* () {
  const page = yield* makePageWorld();
  let keys = 0;
  const operationId = () => `lanes-${++keys}`;
  const started = Effect.fnUntraced(function* (label: string) {
    return yield* Effect.acquireRelease(
      Effect.gen(function* () {
        const answer = yield* page
          .perform<unknown>('start_terminal', {
            operationId: operationId(),
            cwd: page.world.sourceCheckout,
            label,
            transport: 'pty',
            lifetime: 'held',
            geometry: { rows: 24, columns: 80 },
          })
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(TerminalOperationReading)));
        const operation = answer.operation;
        if (operation._tag !== 'Whole' || operation.state._tag !== 'Settled' || operation.state.execution === undefined) {
          return yield* Effect.die(new Error(`no execution was raised for ${label}`));
        }
        return operation.state.execution;
      }),
      (execution) =>
        page
          .perform('stop_terminal', {
            ...address(execution),
            operationId: operationId(),
            cause: 'explicit-stop',
          })
          .pipe(Effect.orDie),
    );
  });
  const opened = (execution: ExecutionRef, view: string) =>
    page
      .perform<unknown>('open_terminal_lane', {
        ...address(execution),
        view,
      })
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(TerminalLaneOpened)));
  const typed = (execution: ExecutionRef, lane: TerminalLaneOpened, sequence: number, text: string, cause: ViewInputCause = 'typed') =>
    page
      .perform<unknown>('input_terminal', {
        ...address(execution),
        binding: lane.binding,
        sequence,
        cause,
        act: { _tag: 'Write', bytes: Buffer.from(text).toString('base64') },
      })
      .pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(knownAnswer(LANE_OPERATIONS.input_terminal.answer))),
        Effect.map((answered) => answered.answer),
      );
  const echoed = (execution: ExecutionRef, want: readonly string[], stream: 'pty' | 'stdout' = 'pty') =>
    settles(
      page.perform<unknown>('read_terminal_bytes', { ...address(execution), stream, offset: ByteOffset.make('0') }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(TerminalBytesReading)),
        Effect.map((chunk) => Buffer.from(chunk.bytes, 'base64').toString('utf8')),
      ),
      (seen) => want.every((word) => seen.includes(word)),
    );
  const gridOf = (execution: ExecutionRef) =>
    page.perform<unknown>('read_terminal_screen', address(execution)).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(TerminalScreenReading)),
      Effect.map(({ screen }): TerminalBox | null =>
        screen._tag === 'ScreenTextFrame' ? { rows: screen.geometry.rows, columns: screen.geometry.columns } : null,
      ),
    );
  const grid = (execution: ExecutionRef, view: string, box: TerminalBox | undefined): TerminalGridSubscription => ({
    projectId: page.projectId,
    ...address(execution),
    view: ViewId.make(view),
    box,
  });
  const report = (execution: ExecutionRef, view: string, box: TerminalBox): TerminalGridReport => ({
    projectId: page.projectId,
    ...address(execution),
    view: ViewId.make(view),
    box,
  });
  const window = Effect.fnUntraced(function* () {
    const scope = yield* Scope.fork(yield* Effect.scope);
    const protocol = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Socket.layerWebSocket(`${page.origin.replace('http:', 'ws:')}${TAGMA_SOCKET_PATH}`)),
      Layer.provide([liveSerialization, Socket.layerWebSocketConstructorGlobal]),
    );
    const context = yield* Layer.build(protocol).pipe(Scope.provide(scope));
    const client: LiveClient = yield* RpcClient.make(LiveRpc).pipe(Effect.provide(context), Scope.provide(scope));
    const listen = <A, E>(stream: Stream.Stream<A, E>) => Stream.toQueue(stream, { capacity: 'unbounded' }).pipe(Scope.provide(scope));
    const heard = (execution: ExecutionRef, view: string, box: TerminalBox) =>
      client['terminal.grid.report'](report(execution, view, box)).pipe(
        Effect.retry({
          schedule: Schedule.spaced('25 millis'),
          while: (failure) => Predicate.hasProperty(failure, 'code') && failure.code === 'terminal-view-unknown',
        }),
      );
    return { client, listen, heard, close: Scope.close(scope, Exit.void) };
  });
  return ViewFixture.of({ ...page, operationId, started, opened, typed, echoed, gridOf, grid, report, window });
});

const viewWorld = kind(ViewFixture, (_params: null) => makeViewFixture.pipe(Effect.provide(BunFileSystem.layer)));
export const viewFixture = (): Layer.Layer<ViewFixture | FileSystem.FileSystem, unknown> =>
  world(viewWorld, null).pipe(Layer.provideMerge(BunFileSystem.layer));
