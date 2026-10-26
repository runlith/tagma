import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { threadStoreFixture } from '../threadStoreFixture.js';
import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { dirname, join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { threadProjection } from '../../../threads/testing/doubles.js';
import { threadRolloutReport } from '../../../threads/testing/doubles.js';
import { compressRollout } from '../../../threads/testing/doubles.js';
import { ENTRY_KINDS } from '../../manifest.js';

const threadId = 'thread-under-report';

const meta = () => `${JSON.stringify({ thread: { id: threadId }, facet: null, session: null })}\n`;
const event = (position: number, id: string) =>
  `${JSON.stringify({ kind: 'event', row: { threadId, position, id, kind: 'message', payload: { withdrawn: { runId: id, keepMessages: 0 } } } })}\n`;

const stand = Effect.fnUntraced(function* () {
  const fixture = yield* threadStoreFixture;
  const runtime = Context.merge(fixture.context, yield* Layer.build(BunFileSystem.layer));
  const context = runtime;
  const { db } = Context.get(context, MachineStore);
  yield* Effect.provide(
    bornThread(
      db,
      {
        id: threadId,
        ownerId: 'operator',
        agentId: 'tagma',
        spawnRootId: threadId,
        cacheGroup: threadId,
        authority: THREAD_AUTHORITY_DEFAULT,
      },
      { projectId: fixture.projectId },
    ),
    runtime,
  );
  const home = yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'tagma-rollout-report-' });
  const path = join(home, String(fixture.projectId), `${threadId}.jsonl`);
  const files = Context.get(runtime, FileSystem.FileSystem);
  yield* files.makeDirectory(dirname(path), { recursive: true });
  yield* files.writeFileString(path, meta());
  const projection = yield* Effect.provide(threadProjection(ENTRY_KINDS), runtime);
  const report = yield* Effect.provide(threadRolloutReport(projection), runtime);
  return {
    runtime,
    projection,
    path,
    files,
    append: (text: string) => files.writeFileString(path, text, { flag: 'a' }),
    boot: () =>
      Effect.provide(
        projection.run({ threadId, path }).pipe(
          Effect.catch((failure) => projection.record(failure)),
          Effect.asVoid,
        ),
        runtime,
      ),
    read: (records?: number) => Effect.provide(report.read({ threadId, path, records }), runtime),
    refusal: () => Effect.provide(projection.refusal(threadId), runtime),
  };
});

describe('one read prints where the file and the rows disagree', () => {
  it.live(
    'a position minted twice names both records the file carries and the one the rows hold',
    Effect.fnUntraced(function* () {
      const it = yield* stand();
      yield* it.append(`${event(1, 'a')}${event(2, 'b')}`);
      yield* it.boot();
      yield* it.append(`${event(2, 'b-again')}${event(3, 'c')}`);
      yield* it.boot();
      const answer = yield* it.read();
      expect(answer.refusal).not.toBeNull();
      expect(answer.refusal?.reason).toBe('out-of-order');
      expect(answer.refusal?.nextPosition).toBe(3);
      expect(answer.path).toBe(it.path);
      expect(answer.file.map((record) => record.position)).toEqual([2, 3]);
      expect(answer.file.map((record) => record.id)).toEqual(['b-again', 'c']);
      expect(answer.file[0]?.byteOffset).toBe(answer.refusal?.nextByteOffset ?? -1);
      expect(answer.rows).toEqual([{ position: 2, id: 'b', kind: 'message' }]);
      expect(answer.bounded).toBe(false);
    }),
  );

  it.live(
    'a thread with no recorded projection refusal answers its file state',
    Effect.fnUntraced(function* () {
      const it = yield* stand();
      yield* it.append(event(1, 'a'));
      yield* it.boot();
      const answer = yield* it.read();
      expect(answer.fileForm).toBe('plain');
      expect(answer.refusal).toBeNull();
      expect(answer.file).toEqual([]);
      expect(answer.rows).toEqual([]);
    }),
  );

  it.live(
    'a whole line that is not JSON is named where it stands',
    Effect.fnUntraced(function* () {
      const it = yield* stand();
      yield* it.append(event(1, 'a'));
      yield* it.boot();
      yield* it.append('this line is not json\n');
      yield* it.boot();
      const answer = yield* it.read();
      expect(answer.refusal?.reason).toBe('corrupt');
      expect(answer.file).toEqual([{ byteOffset: answer.refusal?.nextByteOffset ?? -1, position: null, id: null, kind: 'unreadable' }]);
    }),
  );

  it.live(
    'the window is bounded at the size it was asked for',
    Effect.fnUntraced(function* () {
      const it = yield* stand();
      yield* it.append(event(1, 'a'));
      yield* it.boot();
      yield* it.append(Array.from({ length: 8 }, (_, i) => event(9 + i, `far-${i}`)).join(''));
      yield* it.boot();
      const bounded = yield* it.read(3);
      expect(bounded.file.length).toBe(3);
      expect(bounded.bounded).toBe(true);
      const whole = yield* it.read();
      expect(whole.file.length).toBe(8);
      expect(whole.bounded).toBe(false);
    }),
  );

  it.live(
    'a refusal whose file has gone still answers, naming that the file is gone',
    Effect.fnUntraced(function* () {
      const it = yield* stand();
      yield* it.append(`${event(1, 'a')}${event(1, 'a-again')}`);
      yield* it.boot();
      yield* it.files.remove(it.path);
      const answer = yield* it.read();
      expect(answer.path).toBeNull();
      expect(answer.refusal).not.toBeNull();
      expect(answer.file).toEqual([]);
    }),
  );

  it.live(
    'a compressed rollout retains its refusal without expanding the file',
    Effect.fnUntraced(function* () {
      const it = yield* stand();
      yield* it.append(`${event(1, 'a')}${event(3, 'c')}`);
      yield* it.boot();
      yield* Effect.provide(compressRollout(it.path), it.runtime);
      const answer = yield* it.read(5);
      expect(answer.refusal?.reason).toBe('out-of-order');
      expect(answer.fileForm).toBe('compressed');
      expect(answer.path).toBe(`${it.path}.zst`);
      expect(answer.file).toEqual([]);
      expect(yield* it.files.exists(it.path)).toBe(false);
      expect(yield* it.files.exists(`${it.path}.zst`)).toBe(true);
    }),
  );

  it.live(
    'reading the disagreement leaves the refusal exactly where it stood',
    Effect.fnUntraced(function* () {
      const it = yield* stand();
      yield* it.append(`${event(1, 'a')}${event(3, 'c')}`);
      yield* it.boot();
      const before = yield* it.refusal();
      yield* it.read();
      yield* it.read();
      expect(yield* it.refusal()).toEqual(before);
    }),
  );
});
