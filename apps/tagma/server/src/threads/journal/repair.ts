import { copyFile, open, rename, rm, stat, type FileHandle } from 'node:fs/promises';
import { Clock, Effect } from 'effect';
import { decodeThreadEventPayload } from '@runlith/agent/thread/events';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { threadRolloutCursor } from '../store/journal.js';
import { ROLLOUT_BLOCK, fileSize, readRolloutLine, rolloutEventOf, wholeLinesAfter } from './rolloutFile.js';
import { ThreadProjectionRefused } from './projection.js';
import { rolloutReplacedIn } from './rolloutGeneration.js';
import { RolloutReads, type ReadRollout } from '../contract/service/rolloutReads.js';

const onDisk = <A>(threadId: string, what: string, act: () => Promise<A>) =>
  Effect.tryPromise({
    try: act,
    catch: (error) =>
      new ThreadProjectionRefused({
        reason: 'io',
        threadId,
        message: `${what} failed: ${error instanceof Error ? error.message : String(error)}`,
      }),
  });

export type ThreadRolloutRepair = Effect.Success<typeof makeThreadRolloutRepair>;

export const makeThreadRolloutRepair = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const kinds = yield* ThreadEntryKinds;

  const rewrite = (threadId: string, path: string, into: string) =>
    Effect.flatMap(RolloutReads, (observe) =>
      Effect.tryPromise({
        try: async () => {
          const size = (await stat(path)).size;
          const out = await open(into, 'w');
          let records = 0;
          let renumbered = 0;
          let position = 1;
          let read = 0;
          try {
            for await (const { line, end } of wholeLinesAfter(path, 0, observe)) {
              read = end;
              if (line === '') {
                await out.write('\n');
                continue;
              }
              const parsed = readRolloutLine(line);
              if ('failure' in parsed) {
                throw new ThreadProjectionRefused({
                  reason: 'corrupt',
                  threadId,
                  message: `the line ending at byte ${end} ${parsed.failure}, so this rollout is not a renumbering`,
                });
              }
              records += 1;
              if (parsed.record.kind !== 'event') {
                await out.write(`${line}\n`);
                continue;
              }
              const fact = rolloutEventOf(parsed.record);
              if (fact === null) {
                throw new ThreadProjectionRefused({
                  reason: 'corrupt',
                  threadId,
                  message: `the event ending at byte ${end} carries no position, id, kind and payload, so it is not renumbered`,
                });
              }
              try {
                decodeThreadEventPayload(kinds, fact.payload);
              } catch (error) {
                throw new ThreadProjectionRefused({
                  reason: 'corrupt',
                  threadId,
                  message: `the event ending at byte ${end} carries a payload this log cannot read, so it is not renumbered: ${error instanceof Error ? error.message : String(error)}`,
                });
              }
              if (fact.position !== position) renumbered += 1;
              await out.write(`${JSON.stringify({ ...parsed.record, row: { ...fact, position } })}\n`);
              position += 1;
            }
            if (read < size) await copyBytes(path, out, read, size, observe);
            await out.sync();
          } catch (error) {
            await out.close();
            await rm(into, { force: true });
            throw error;
          }
          await out.close();
          return { records, renumbered };
        },
        catch: (error) =>
          error instanceof ThreadProjectionRefused
            ? error
            : new ThreadProjectionRefused({
                reason: 'io',
                threadId,
                message: `the rollout at ${path} could not be rewritten: ${error instanceof Error ? error.message : String(error)}`,
              }),
      }),
    );

  return {
    repair: Effect.fn('ThreadRolloutRepair.repair')(function* ({ threadId, path }: { readonly threadId: string; readonly path: string }) {
      if ((yield* onDisk(threadId, `reading ${path}`, () => fileSize(path))) === null) {
        return yield* new ThreadProjectionRefused({ reason: 'io', threadId, message: `there is no rollout at ${path}` });
      }
      const stamp = new Date(yield* Clock.currentTimeMillis).toISOString().replace(/[:.]/g, '-');
      const kept = `${path}.${stamp}.original`;
      const rewritten = `${path}.${stamp}.repair`;
      const counted = yield* rewrite(threadId, path, rewritten);
      yield* units
        .write(writes('ThreadRolloutRepair.repair', [threadRolloutCursor]), (unit) => rolloutReplacedIn(db, unit, threadId, path))
        .pipe(Effect.mapError((cause) => new ThreadProjectionRefused({ reason: 'io', threadId, message: cause.message })));
      yield* onDisk(threadId, `keeping the original beside ${path}`, async () => {
        await copyFile(path, kept);
        await rename(rewritten, path);
      });
      return { threadId, path, kept, ...counted };
    }),
  };
});

async function copyBytes(path: string, out: FileHandle, from: number, to: number, observe: ReadRollout): Promise<void> {
  const handle = await open(path, 'r');
  try {
    let at = from;
    const buffer = Buffer.alloc(Math.min(ROLLOUT_BLOCK, to - from));
    while (at < to) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, to - at), at);
      observe({ path, bytes: bytesRead });
      if (bytesRead <= 0) break;
      await out.write(buffer.subarray(0, bytesRead));
      at += bytesRead;
    }
  } finally {
    await handle.close();
  }
}
