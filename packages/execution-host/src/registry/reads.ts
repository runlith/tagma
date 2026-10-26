import { Data, Deferred, Effect, Ref, Context, Scope } from 'effect';
import { ExecutionId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { type InputProfile } from '@runlith/executions/protocol/inputProfile';
import {
  type FrameRevision,
  type ScreenRead,
  type ScreenAnswer,
  type ScreenFeedItem,
  type ScreenPointed,
  type ScreenPointRead,
} from '@runlith/executions/protocol/presentation';
import { type ByteCursor, ByteOffset, type Stream as RecordStream, type StreamPositions } from '@runlith/executions/protocol/record';
import { type ReadFailure, StreamMissing } from '../ExecutionRecord';
import { type HoldCut, type HoldStalled } from '@runlith/held/failures';
import { ExecutionUnknown, ExecutionUnreadable } from '../executionFailures';
import { sameRef, type ProfiledRead } from '../RetainedRecordReads';
import { type ScreenViewerId, type FrameCreditRefused } from '../Presentation';
import { screenPoint } from '../screenPoint';
import { baseColors } from './assembly';
import { type ReaderId, type CreditRefused, type PullFailure, type ReaderMissing, type ReaderPull } from '../RecordReaders';
import { type CapacityRefused, type ReservationMissing } from '../ExecutionCapacity';
import { PIPE_MODES, type Live, type Reading, type RegistryState, live, recordHandles } from './state';
import { ExecutionRefused, leased, releaseSoon } from './retention';
import { type RetainedRecord } from '@runlith/executions/protocol/runtime';

export type ReaderOpenFailure = CapacityRefused | ReservationMissing | ReadFailure;

export type ByteReadFailure = ExecutionUnknown | ExecutionRefused | ReaderOpenFailure | HoldStalled | HoldCut;

export class ViewerMissing extends Data.TaggedError('ViewerMissing')<{
  readonly viewer: string;
}> {}

export class ScreenRefused extends Data.TaggedError('ScreenRefused')<{
  readonly execution: string;
}> {}

const liveRead = (registry: RegistryState, found: Live, cursor: ByteCursor, limit: number) => {
  return Effect.flatMap(leased(registry, found, found.execution.record.read(cursor, limit)), (read) =>
    Effect.map(found.execution.interpretation?.profile() ?? Effect.succeed<InputProfile>(PIPE_MODES), (modes) => ({ ...read, modes })),
  );
};

const readOnce = (registry: RegistryState, cursor: ByteCursor, limit: number): Effect.Effect<ProfiledRead, ByteReadFailure> => {
  const { held, shelf } = registry;
  return Effect.suspend((): Effect.Effect<ProfiledRead, ByteReadFailure> => {
    const found = held.get(cursor.ref.execution);
    return found !== undefined && sameRef(found.ref, cursor.ref) ? liveRead(registry, found, cursor, limit) : shelf.read(cursor, limit);
  });
};

const read = (registry: RegistryState, cursor: ByteCursor, limit: number) => {
  const { shelf } = registry;
  return readOnce(registry, cursor, limit).pipe(
    Effect.catchTag('ExecutionRefused', (retiring) =>
      Effect.suspend(() => {
        const gate = shelf.gate(cursor.ref.execution);
        if (gate !== undefined) return Effect.andThen(Deferred.await(gate), readOnce(registry, cursor, limit));
        return shelf.has(cursor.ref.execution) ? readOnce(registry, cursor, limit) : Effect.fail(retiring);
      }),
    ),
  );
};

const readerReady = Effect.fn('HostByteRecords.readerReady')(function* (registry: RegistryState, execution: ExecutionId) {
  for (;;) {
    const changed = yield* Ref.get(registry.inventoryWake);
    const found = registry.held.get(execution);
    if (found !== undefined) return found;
    if (!(yield* Ref.get(registry.queued)).has(execution)) return yield* new ExecutionUnknown({ execution });
    yield* Deferred.await(changed);
  }
});

const openReader = (registry: RegistryState, execution: ExecutionId, stream: RecordStream, from: ByteOffset) => {
  const { shelf } = registry;
  return Effect.flatMap(readerReady(registry, execution), (found) =>
    Effect.andThen(
      Effect.acquireRelease(
        Effect.flatten(
          Ref.modify(found.reading, (reading): readonly [Effect.Effect<void, ExecutionRefused>, Reading] =>
            reading.fenced && shelf.gate(execution) !== undefined
              ? [Effect.fail(new ExecutionRefused({ execution })), reading]
              : [Effect.void, { ...reading, readers: reading.readers + 1 }],
          ),
        ),
        () =>
          Effect.andThen(
            Ref.update(found.reading, (reading) => ({ ...reading, readers: Math.max(0, reading.readers - 1) })),
            releaseSoon(registry, found),
          ),
      ),
      found.execution.readers.open(stream, from),
    ),
  );
};

const grant = (registry: RegistryState, execution: ExecutionId, reader: ReaderId, bytes: number) => {
  return Effect.flatMap(live(registry, execution), (found) => found.execution.readers.grant(reader, bytes));
};

const pull = (registry: RegistryState, execution: ExecutionId, reader: ReaderId) => {
  return Effect.flatMap(live(registry, execution), (found) => leased(registry, found, found.execution.readers.pull(reader)));
};

const awaitBytes = (registry: RegistryState, execution: ExecutionId, reader: ReaderId) => {
  return Effect.flatMap(live(registry, execution), (found) => found.execution.readers.awaitMore(reader));
};

const positions = (registry: RegistryState, execution: ExecutionId, reader: ReaderId) => {
  return Effect.flatMap(live(registry, execution), (found) => found.execution.readers.positions(reader));
};

const screen = (registry: RegistryState, execution: ExecutionId, request?: ScreenRead) => {
  return Effect.flatMap(live(registry, execution), (found) => found.execution.screen(request));
};

const point = (registry: RegistryState, execution: ExecutionId, request?: ScreenPointRead) => {
  const { fs, path, limits } = registry;
  return Effect.flatMap(live(registry, execution), (found) =>
    screenPoint(
      fs,
      path,
      found.execution.record,
      found.execution.interpretation,
      limits,
      request?.scrollback ?? Number.POSITIVE_INFINITY,
      baseColors(),
    ),
  );
};

const openViewer = (registry: RegistryState, execution: ExecutionId, base?: FrameRevision) => {
  const { capacity } = registry;
  return Effect.flatMap(live(registry, execution), (found) =>
    Effect.flatMap(
      Effect.acquireRelease(capacity.reserveReader(found.ref.execution), () =>
        capacity.releaseReader(found.ref.execution).pipe(Effect.catchTag('ReservationMissing', () => Effect.void)),
      ),
      () =>
        found.execution.presentation === undefined
          ? Effect.fail(new ScreenRefused({ execution }))
          : found.execution.presentation.openViewer(base),
    ),
  );
};

const grantFrame = (registry: RegistryState, execution: ExecutionId, viewer: ScreenViewerId, frames: number) => {
  return Effect.flatMap(live(registry, execution), (found) =>
    found.execution.presentation === undefined
      ? Effect.fail(new ViewerMissing({ viewer }))
      : found.execution.presentation
          .grant(viewer, frames)
          .pipe(Effect.catchTag('ViewerUnknown', () => Effect.fail(new ViewerMissing({ viewer })))),
  );
};

const awaitFrame = (registry: RegistryState, execution: ExecutionId, viewer: ScreenViewerId) => {
  return Effect.flatMap(live(registry, execution), (found) =>
    found.execution.presentation === undefined
      ? Effect.fail(new ViewerMissing({ viewer }))
      : found.execution.presentation.await(viewer).pipe(Effect.catchTag('ViewerUnknown', () => Effect.fail(new ViewerMissing({ viewer })))),
  );
};

const nextFrame = (registry: RegistryState, execution: ExecutionId, viewer: ScreenViewerId) => {
  return Effect.flatMap(live(registry, execution), (found) =>
    found.execution.presentation === undefined
      ? Effect.fail(new ViewerMissing({ viewer }))
      : leased(
          registry,
          found,
          found.execution.presentation
            .next(viewer)
            .pipe(Effect.catchTag('ViewerUnknown', () => Effect.fail(new ViewerMissing({ viewer })))),
        ),
  );
};

const awaitRead = (registry: RegistryState, execution: ExecutionId) => {
  const { capacity } = registry;
  return Effect.flatMap(live(registry, execution), (found) => capacity.awaitRead(found.ref.execution));
};

export class HostByteRecords extends Context.Service<
  HostByteRecords,
  {
    readonly read: (cursor: ByteCursor, limit: number) => Effect.Effect<ProfiledRead, ByteReadFailure>;
    readonly openReader: (
      execution: ExecutionId,
      stream: RecordStream,
      from: ByteOffset,
    ) => Effect.Effect<ReaderId, ExecutionUnknown | ExecutionRefused | ReaderOpenFailure, Scope.Scope>;
    readonly grant: (
      execution: ExecutionId,
      reader: ReaderId,
      bytes: number,
    ) => Effect.Effect<number, ExecutionUnknown | ReaderMissing | CreditRefused>;
    readonly pull: (
      execution: ExecutionId,
      reader: ReaderId,
    ) => Effect.Effect<ReaderPull, ExecutionUnknown | ExecutionRefused | PullFailure | CapacityRefused | ReservationMissing>;
    readonly awaitBytes: (
      execution: ExecutionId,
      reader: ReaderId,
    ) => Effect.Effect<boolean, ExecutionUnknown | ReaderMissing | StreamMissing>;
    readonly positions: (
      execution: ExecutionId,
      reader: ReaderId,
    ) => Effect.Effect<StreamPositions, ExecutionUnknown | ReaderMissing | StreamMissing>;
    readonly awaitRead: (execution: ExecutionId) => Effect.Effect<void, ExecutionUnknown | ReservationMissing | CapacityRefused>;
    readonly openHandles: () => ReadonlyMap<ExecutionId, number>;
    readonly sealed: (execution: ExecutionId) => Effect.Effect<boolean>;
    readonly retained: (execution: ExecutionRef) => Effect.Effect<RetainedRecord | undefined, ExecutionUnreadable>;
  }
>()('@runlith/execution-host/HostByteRecords') {}

export class TerminalScreen extends Context.Service<
  TerminalScreen,
  {
    readonly screen: (execution: ExecutionId, request?: ScreenRead) => Effect.Effect<ScreenAnswer, ExecutionUnknown>;
    readonly point: (execution: ExecutionId, request?: ScreenPointRead) => Effect.Effect<ScreenPointed, ExecutionUnknown>;
    readonly openViewer: (
      execution: ExecutionId,
      base?: FrameRevision,
    ) => Effect.Effect<ScreenViewerId, ExecutionUnknown | ScreenRefused | ReaderOpenFailure, Scope.Scope>;
    readonly grantFrame: (
      execution: ExecutionId,
      viewer: ScreenViewerId,
      frames: number,
    ) => Effect.Effect<number, ExecutionUnknown | ViewerMissing | FrameCreditRefused>;
    readonly awaitFrame: (execution: ExecutionId, viewer: ScreenViewerId) => Effect.Effect<boolean, ExecutionUnknown | ViewerMissing>;
    readonly nextFrame: (
      execution: ExecutionId,
      viewer: ScreenViewerId,
    ) => Effect.Effect<
      ScreenFeedItem | undefined,
      ExecutionUnknown | ExecutionRefused | ViewerMissing | CapacityRefused | ReservationMissing
    >;
  }
>()('@runlith/execution-host/TerminalScreen') {}

export const hostByteRecordsOf = (registry: RegistryState) =>
  HostByteRecords.of({
    read: (cursor, limit) => read(registry, cursor, limit),
    openReader: (execution, stream, from) => openReader(registry, execution, stream, from),
    grant: (execution, reader, bytes) => grant(registry, execution, reader, bytes),
    pull: (execution, reader) => pull(registry, execution, reader),
    awaitBytes: (execution, reader) => awaitBytes(registry, execution, reader),
    positions: (execution, reader) => positions(registry, execution, reader),
    awaitRead: (execution) => awaitRead(registry, execution),
    openHandles: () => recordHandles(registry),
    sealed: (execution) => registry.shelf.sealed(execution),
    retained: (ref) => registry.shelf.retained(ref),
  });

export const terminalScreenOf = (registry: RegistryState) =>
  TerminalScreen.of({
    screen: (execution, request) => screen(registry, execution, request),
    point: (execution, request) => point(registry, execution, request),
    openViewer: (execution, base) => openViewer(registry, execution, base),
    grantFrame: (execution, viewer, frames) => grantFrame(registry, execution, viewer, frames),
    awaitFrame: (execution, viewer) => awaitFrame(registry, execution, viewer),
    nextFrame: (execution, viewer) => nextFrame(registry, execution, viewer),
  });
