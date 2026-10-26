import { Effect } from 'effect';
import { and, eq, inArray } from 'drizzle-orm';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { threadEvent } from '../store/journal.js';
import type { ThreadRolloutDisagreement, ThreadRolloutFileRecord } from '../contract/wire/evidence.js';
import type { ThreadProjectionRefusalReason } from '../contract/wire/projection.js';
import type { ThreadProjection } from './projection.js';
import { readRolloutLine, rolloutEventOf, wholeLinesAfter } from './rolloutFile.js';
import { rolloutStateOf } from './rolloutForms.js';
import { RolloutReads, type ReadRollout } from '../contract/service/rolloutReads.js';

export const ROLLOUT_WINDOW_RECORDS = 12;

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type RolloutRefusalReasonProjectsForm = Assert<
  Exact<NonNullable<ThreadRolloutDisagreement['refusal']>['reason'], ThreadProjectionRefusalReason>
>;

type Window = { readonly file: readonly ThreadRolloutFileRecord[]; readonly bounded: boolean };

const windowOf = async (path: string, from: number, records: number, observe: ReadRollout): Promise<Window> => {
  const file: ThreadRolloutFileRecord[] = [];
  for await (const { line, end } of wholeLinesAfter(path, from, observe)) {
    if (line === '') continue;
    if (file.length === records) return { file, bounded: true };
    const byteOffset = end - Buffer.byteLength(line, 'utf8') - 1;
    const read = readRolloutLine(line);
    if ('failure' in read) {
      file.push({ byteOffset, position: null, id: null, kind: 'unreadable' });
      continue;
    }
    const fact = rolloutEventOf(read.record);
    if (read.record.kind !== 'event' || fact === null) {
      file.push({
        byteOffset,
        position: null,
        id: null,
        kind: read.record.kind === 'event' ? 'unreadable' : (read.record.kind ?? 'meta'),
      });
      continue;
    }
    file.push({ byteOffset, position: fact.position, id: fact.id, kind: fact.kind });
  }
  return { file, bounded: false };
};

const windowAt = (path: string | null, from: number, records: number): Effect.Effect<Window> =>
  path === null
    ? Effect.succeed({ file: [], bounded: false })
    : Effect.flatMap(RolloutReads, (read) => Effect.promise(() => windowOf(path, from, records, read)));

export type ThreadRolloutReport = Effect.Success<ReturnType<typeof makeThreadRolloutReport>>;

export const makeThreadRolloutReport = Effect.fnUntraced(function* ({ projection }: { readonly projection: ThreadProjection }) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  return {
    read: Effect.fnUntraced(function* (input: { readonly threadId: string; readonly path: string | undefined; readonly records?: number }) {
      const found = input.path === undefined ? null : yield* rolloutStateOf(input.path);
      const path = found?.path ?? null;
      const fileForm = found?.form ?? 'missing';
      const standing = yield* projection.refusal(input.threadId);
      if (standing === undefined) {
        return {
          threadId: input.threadId,
          path,
          fileForm,
          refusal: null,
          file: [],
          bounded: false,
          rows: [],
        } satisfies ThreadRolloutDisagreement;
      }
      const { file, bounded } = yield* windowAt(
        fileForm === 'plain' ? path : null,
        standing.nextByteOffset,
        input.records ?? ROLLOUT_WINDOW_RECORDS,
      );
      const named = [...new Set(file.flatMap((record) => (record.position === null ? [] : [record.position])))];
      const rows =
        named.length === 0
          ? []
          : yield* units.read((unit) =>
              unit.run(
                db
                  .select({ position: threadEvent.position, id: threadEvent.id, kind: threadEvent.kind })
                  .from(threadEvent)
                  .where(and(eq(threadEvent.threadId, input.threadId), inArray(threadEvent.position, named))),
              ),
            );
      return {
        threadId: input.threadId,
        path,
        fileForm,
        refusal: {
          reason: standing.reason,
          message: standing.message,
          nextByteOffset: standing.nextByteOffset,
          nextPosition: standing.nextPosition,
          seenAt: standing.seenAt.toISOString(),
        },
        file,
        bounded,
        rows,
      } satisfies ThreadRolloutDisagreement;
    }),
  };
});
