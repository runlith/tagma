import { Data, Effect, FileSystem, Path } from 'effect';
import type { HoldCut, HoldStalled } from '@runlith/held/failures';
import { ExecutionUnknown, ExecutionUnreadable } from './executionFailures';
import type { ExecutionId, ExecutionRef, Incarnation, StreamEnding, Transport } from '@runlith/executions/protocol/execution';
import type { InputProfile } from '@runlith/executions/protocol/inputProfile';
import type { ByteCursor, StreamPositions } from '@runlith/executions/protocol/record';
import type { RetainedRecord } from '@runlith/executions/protocol/runtime';
import { RecordFiles, type RecordReadFailure, type SealedRecord } from '@runlith/executions/RecordFiles';
import { RecordNameInvalid, recordFolder } from '@runlith/executions/recordFormat';
import { CursorRefused, RecordReadFailed, StreamMissing, type ReadFailure, type RecordRead } from './ExecutionRecord';
import { ExecutionStore } from './store/ExecutionStore';
import type { IncarnationRecord } from './store/records';
import type { GenerationReadLeases } from './GenerationReadLeases';

export type ProfiledRead = RecordRead & { readonly modes: InputProfile; readonly ending?: StreamEnding };

type Retained = {
  readonly ref: ExecutionRef;
  readonly record: SealedRecord;
  readonly transport: Transport;
};

export class RecordUnopened extends Data.TaggedError('RecordUnopened')<{
  readonly act: 'open' | 'missing';
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

const RETIRED_MODES: InputProfile = {
  _tag: 'Unavailable',
  revision: 0,
  reason: 'the generation that interpreted this terminal ended',
};

export const sealedRefusal =
  (cursor: ByteCursor, transport: Transport) =>
  (failure: RecordReadFailure): ReadFailure => {
    if (failure._tag === 'RecordCursorRefused') {
      return failure.reason === 'stream'
        ? new StreamMissing({ stream: cursor.stream, transport })
        : new CursorRefused({ reason: failure.reason, detail: failure.detail });
    }
    return new RecordReadFailed({
      stream: cursor.stream,
      act: failure.reason === 'missing' ? 'missing' : 'read',
      detail: `${failure._tag} ${failure.reason}: ${failure.detail}`,
    });
  };

const keyOf = (incarnation: Incarnation, execution: ExecutionId): string => `${incarnation}/${execution}`;

export const sameRef = (left: ExecutionRef, right: ExecutionRef): boolean =>
  left.installation === right.installation && left.execution === right.execution && left.incarnation === right.incarnation;

export type RetainedInput = {
  readonly current: IncarnationRecord;
  readonly records: string;
  readonly chunkBytes: number;
  readonly pipeModes: InputProfile;
  readonly leases: GenerationReadLeases;
};

export const makeRetainedRecordReads = Effect.fnUntraced(function* (options: RetainedInput) {
  const { current, records, chunkBytes, pipeModes, leases } = options;
  const store = yield* ExecutionStore;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files = yield* Effect.provide(RecordFiles, RecordFiles.layer);
  const opened = new Map<string, Retained>();

  const open = Effect.fnUntraced(function* (ref: ExecutionRef) {
    const evidence = yield* store
      .evidenceOf(ref)
      .pipe(
        Effect.mapError((failure) =>
          failure._tag === 'StoredExecutionMissing'
            ? new ExecutionUnknown({ execution: ref.execution })
            : new RecordUnopened({ act: 'open', detail: `the retired generation's rows did not answer: ${failure._tag}` }),
        ),
      );
    if (evidence.record.state.record === 'unavailable') {
      return yield* new RecordUnopened({
        act: 'missing',
        detail: 'the generation that wrote this record gave its bytes back before it ended',
      });
    }
    const record = yield* files.open(records, ref).pipe(
      Effect.mapError(
        (failure) =>
          new RecordUnopened({
            act: failure._tag === 'RecordSealMissing' ? 'missing' : 'open',
            detail: `${failure._tag === 'RecordUnreadable' ? `${failure._tag} ${failure.reason}` : failure._tag}: the record of a retired generation`,
          }),
      ),
    );
    const retained = { ref, record, transport: evidence.record.state.transport };
    opened.set(keyOf(ref.incarnation, ref.execution), retained);
    return retained;
  });

  const retainedOf = (ref: ExecutionRef): Effect.Effect<Retained, ExecutionUnknown | RecordUnopened> =>
    Effect.suspend(() => {
      const hit = opened.get(keyOf(ref.incarnation, ref.execution));
      return hit !== undefined && sameRef(hit.ref, ref) ? Effect.succeed(hit) : open(ref);
    });

  const leased = <A, E>(ref: ExecutionRef, use: Effect.Effect<A, E>): Effect.Effect<A, E | ExecutionUnknown | HoldStalled | HoldCut> =>
    ref.installation !== current.installation || ref.incarnation > current.incarnation
      ? Effect.fail(new ExecutionUnknown({ execution: ref.execution }))
      : Effect.acquireUseRelease(
          leases.admitRetainedRead(ref),
          () => use,
          () => leases.releaseRetainedRead(ref.incarnation),
        );

  const read = (cursor: ByteCursor, limit: number): Effect.Effect<ProfiledRead, ExecutionUnknown | ReadFailure | HoldStalled | HoldCut> =>
    leased(
      cursor.ref,
      Effect.gen(function* () {
        const retained = yield* retainedOf(cursor.ref).pipe(
          Effect.mapError((failure) =>
            failure._tag === 'RecordUnopened'
              ? new RecordReadFailed({ stream: cursor.stream, act: failure.act, detail: failure.detail })
              : failure,
          ),
        );
        const bytes = yield* retained.record
          .read(cursor, Math.min(limit, chunkBytes))
          .pipe(Effect.mapError(sealedRefusal(cursor, retained.transport)));
        return {
          ...bytes,
          modes: retained.transport === 'pipes' ? pipeModes : RETIRED_MODES,
        };
      }),
    );

  const positions = (
    ref: ExecutionRef,
  ): Effect.Effect<ReadonlyArray<StreamPositions>, ExecutionUnknown | RecordUnopened | HoldStalled | HoldCut> =>
    leased(
      ref,
      Effect.map(retainedOf(ref), (retained) => retained.record.seal.streams.map((stream) => stream.positions)),
    );

  const evidence = Effect.fnUntraced(function* (ref: ExecutionRef): Effect.fn.Return<RetainedRecord | undefined, ExecutionUnreadable> {
    const found = yield* store.evidenceOf(ref).pipe(
      Effect.catchTag('StoredExecutionMissing', () => Effect.succeed(undefined)),
      Effect.mapError((failure) => new ExecutionUnreadable({ execution: ref.execution, reason: failure._tag })),
    );
    if (found === undefined) return undefined;
    const { record, final } = found;
    return {
      state: record.state,
      native: record.native,
      target: record.target,
      final: final,
    } satisfies RetainedRecord;
  });

  const remove = (incarnation: Incarnation, execution: ExecutionId) =>
    Effect.suspend(() => {
      opened.delete(keyOf(incarnation, execution));
      const folder = recordFolder(execution);
      return folder instanceof RecordNameInvalid
        ? Effect.void
        : fs.remove(path.join(records, folder), {
            recursive: true,
            force: true,
          });
    });

  return { read, positions, evidence, remove };
});
