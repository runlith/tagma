import { Effect, FileSystem, Path } from 'effect';
import type { HoldCut, HoldStalled } from '@runlith/held/failures';
import { ExecutionUnknown, ExecutionUnreadable } from './executionFailures';
import type { ExecutionId, ExecutionRef, Incarnation, StreamEnding, Transport } from '@runlith/executions/protocol/execution';
import type { InputProfile } from '@runlith/executions/protocol/inputProfile';
import type { ByteCursor } from '@runlith/executions/protocol/record';
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

  const open = Effect.fnUntraced(function* (cursor: ByteCursor) {
    const evidence = yield* store.evidenceOf(cursor.ref).pipe(
      Effect.mapError((failure) =>
        failure._tag === 'StoredExecutionMissing'
          ? new ExecutionUnknown({ execution: cursor.ref.execution })
          : new RecordReadFailed({
              stream: cursor.stream,
              act: 'open',
              detail: `the retired generation's rows did not answer: ${failure._tag}`,
            }),
      ),
    );
    if (evidence.record.state.record === 'unavailable') {
      return yield* new RecordReadFailed({
        stream: cursor.stream,
        act: 'missing',
        detail: 'the generation that wrote this record gave its bytes back before it ended',
      });
    }
    const record = yield* files.open(records, cursor.ref).pipe(
      Effect.mapError(
        (failure) =>
          new RecordReadFailed({
            stream: cursor.stream,
            act: failure._tag === 'RecordSealMissing' ? 'missing' : 'open',
            detail: `${failure._tag === 'RecordUnreadable' ? `${failure._tag} ${failure.reason}` : failure._tag}: the record of a retired generation`,
          }),
      ),
    );
    const retained = {
      ref: cursor.ref,
      record,
      transport: evidence.record.state.transport,
    };
    opened.set(keyOf(cursor.ref.incarnation, cursor.ref.execution), retained);
    return retained;
  });

  const read = (cursor: ByteCursor, limit: number): Effect.Effect<ProfiledRead, ExecutionUnknown | ReadFailure | HoldStalled | HoldCut> =>
    cursor.ref.installation !== current.installation || cursor.ref.incarnation > current.incarnation
      ? Effect.fail(new ExecutionUnknown({ execution: cursor.ref.execution }))
      : Effect.acquireUseRelease(
          leases.admitRetainedRead(cursor.ref),
          () =>
            Effect.gen(function* () {
              const hit = opened.get(keyOf(cursor.ref.incarnation, cursor.ref.execution));
              const retained = hit !== undefined && sameRef(hit.ref, cursor.ref) ? hit : yield* open(cursor);
              const bytes = yield* retained.record
                .read(cursor, Math.min(limit, chunkBytes))
                .pipe(Effect.mapError(sealedRefusal(cursor, retained.transport)));
              return {
                ...bytes,
                modes: retained.transport === 'pipes' ? pipeModes : RETIRED_MODES,
              };
            }),
          () => leases.releaseRetainedRead(cursor.ref.incarnation),
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

  return { read, evidence, remove };
});
