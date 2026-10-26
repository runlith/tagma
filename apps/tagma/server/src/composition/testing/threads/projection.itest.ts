import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { threadStoreFixture } from '../threadStoreFixture.js';
import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { dirname, join } from 'node:path';
import { Context, Scope, Effect, FileSystem, Layer } from 'effect';
import { THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import { eq } from 'drizzle-orm';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { threadEvent, threadRolloutCursor, threadRolloutRefusal } from '../../../threads/testing/doubles.js';
import { threadProjection } from '../../../threads/testing/doubles.js';
import { ENTRY_KINDS } from '../../manifest.js';

const stand = Effect.fnUntraced(function* () {
  const fixture = yield* threadStoreFixture;
  const runtime = Context.merge(fixture.context, yield* Layer.build(BunFileSystem.layer));
  const context = runtime;
  const { db } = Context.get(context, MachineStore);
  const threadId = 'thread-under-test';
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
  const home = yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'tagma-projection-' });
  const path = join(home, String(fixture.projectId), `${threadId}.jsonl`);
  const files = Context.get(runtime, FileSystem.FileSystem);
  yield* files.makeDirectory(dirname(path), { recursive: true });
  yield* files.writeFileString(path, `${JSON.stringify({ thread: { id: threadId }, facet: null, session: null })}\n`);
  return {
    runtime,
    db,
    path,
    threadId,
    files,
    appendText: (text: string) => files.writeFileString(path, text, { flag: 'a' }),
    projection: yield* Effect.provide(threadProjection(ENTRY_KINDS), runtime),
    append: (position: number, id: string) =>
      files.writeFileString(
        path,
        `${JSON.stringify({ kind: 'event', row: { threadId, position, id, kind: 'message', payload: { withdrawn: { runId: id, keepMessages: 0 } } } })}\n`,
        { flag: 'a' },
      ),
    rows: () => Effect.provide(db.select().from(threadEvent()).where(eq(threadEvent().threadId, threadId)), runtime),
    cursor: () =>
      Effect.provide(db.select().from(threadRolloutCursor()).where(eq(threadRolloutCursor().threadId, threadId)).get(), runtime),
    refusals: () => Effect.provide(db.select().from(threadRolloutRefusal()), runtime),
  };
});

const standing = Effect.fnUntraced(function* (
  body: (it: Effect.Success<ReturnType<typeof stand>>) => Effect.Effect<void, unknown, Scope.Scope>,
) {
  yield* body(yield* stand());
});

const outcome = <A>(work: Effect.Effect<A, { readonly reason: string }>) =>
  Effect.match(work, {
    onFailure: (failure) => ({ reason: failure.reason, value: undefined }),
    onSuccess: (value) => ({ reason: 'ok', value }),
  });

describe('the rollout is carried into the rows', () => {
  it.live('lines written while the database stood still are projected, and the cursor moves once', () =>
    standing(
      Effect.fnUntraced(function* (it) {
        yield* it.append(1, 'a');
        yield* it.append(2, 'b');
        yield* it.append(3, 'c');
        const first = yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        expect(first.reason).toBe('ok');
        expect(first.value?.projected).toBe(3);
        expect((yield* it.rows()).map((row) => row.position).sort((l, r) => l - r)).toEqual([1, 2, 3]);
        expect((yield* it.cursor())?.nextPosition).toBe(4);
        const again = yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        expect(again.value?.projected).toBe(0);
        expect((yield* it.rows()).length).toBe(3);
      }),
    ),
  );

  it.live('a partial trailing record is left for the next pass, and completing it projects it', () =>
    standing(
      Effect.fnUntraced(function* (it) {
        yield* it.append(1, 'a');
        yield* it.appendText('{"kind":"event","row":{"posi');
        const stopped = yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        expect(stopped.value?.projected).toBe(1);
        const held = yield* it.cursor();
        yield* it.files.truncate(it.path, held?.nextByteOffset ?? 0);
        yield* it.append(2, 'b');
        const resumed = yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        expect(resumed.value?.projected).toBe(1);
        expect((yield* it.rows()).map((row) => row.id).sort()).toEqual(['a', 'b']);
      }),
    ),
  );

  it.live('a whole line that is not JSON stops the pass and leaves the cursor where it was', () =>
    standing(
      Effect.fnUntraced(function* (it) {
        yield* it.append(1, 'a');
        yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        const before = yield* it.cursor();
        yield* it.appendText('this is not json at all\n');
        const failed = yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        expect(failed.reason).toBe('corrupt');
        expect((yield* it.cursor())?.nextByteOffset).toBe(before?.nextByteOffset ?? -1);
      }),
    ),
  );

  it.live('a folded fact in the rollout refuses before it reaches the rows', () =>
    standing(
      Effect.fnUntraced(function* (it) {
        yield* it.appendText(
          `${JSON.stringify({
            kind: 'event',
            row: {
              threadId: it.threadId,
              position: 1,
              id: 'folded',
              kind: 'tool',
              payload: {
                bodyInFold: true,
                entry: {
                  type: 'tool',
                  id: 'tool:c1',
                  runId: 'run-1',
                  toolName: 'read',
                  toolCallId: 'c1',
                  toolState: 'output-available',
                },
              },
            },
          })}\n`,
        );
        const failed = yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        expect(failed.reason).toBe('corrupt');
        expect(yield* it.rows()).toEqual([]);
      }),
    ),
  );

  it.live('a position out of order refuses rather than guessing what is missing', () =>
    standing(
      Effect.fnUntraced(function* (it) {
        yield* it.append(1, 'a');
        yield* it.append(3, 'c');
        const failed = yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        expect(failed.reason).toBe('out-of-order');
      }),
    ),
  );

  it.live('a different fact at a taken position refuses, and never overwrites the row', () =>
    standing(
      Effect.fnUntraced(function* (it) {
        yield* it.append(1, 'a');
        yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        yield* it.files.writeFileString(it.path, `${JSON.stringify({ thread: { id: it.threadId } })}\n`);
        yield* it.append(1, 'other');
        yield* Effect.provide(it.db.delete(threadRolloutCursor()).where(eq(threadRolloutCursor().threadId, it.threadId)), it.runtime);
        const failed = yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        expect(failed.reason).toBe('conflict');
        expect((yield* it.rows())[0]?.id).toBe('a');
      }),
    ),
  );

  it.live('records wider than a read block project, and the cursor lands on the file size', () =>
    standing(
      Effect.fnUntraced(function* (it) {
        const wide = 'a wide line of shell output — '.repeat(20_000);
        yield* it.appendText(
          `${JSON.stringify({ kind: 'event', row: { threadId: it.threadId, position: 1, id: 'wide', kind: 'message', payload: { withdrawn: { runId: wide, keepMessages: 0 } } } })}\n`,
        );
        yield* it.append(2, 'after');
        const run = yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        expect(run.reason).toBe('ok');
        expect(run.value?.projected).toBe(2);
        expect((yield* it.cursor())?.nextByteOffset).toBe(Number((yield* it.files.stat(it.path)).size));
        yield* it.append(3, 'later');
        const again = yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        expect(again.reason).toBe('ok');
        expect(again.value?.projected).toBe(1);
      }),
    ),
  );

  it.live('a cursor standing past the end is not this file, so the file is carried from its start', () =>
    standing(
      Effect.fnUntraced(function* (it) {
        yield* it.append(1, 'a');
        yield* it.append(2, 'b');
        yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        yield* it.files.truncate(it.path, 10);
        const healed = yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        expect(healed.reason).toBe('ok');
        expect((yield* it.cursor())?.nextByteOffset).toBe(0);
      }),
    ),
  );

  it.live('a cursor standing inside a record is dropped, and the republished file reprojects whole', () =>
    standing(
      Effect.fnUntraced(function* (it) {
        yield* it.append(1, 'a');
        yield* it.append(2, 'b');
        yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        const stale = (yield* it.cursor())?.nextByteOffset ?? 0;
        const fat = (position: number, id: string) =>
          `${JSON.stringify({
            kind: 'event',
            row: {
              threadId: it.threadId,
              position,
              id,
              kind: 'message',
              payload: { withdrawn: { runId: 'x'.repeat(200), keepMessages: 0 } },
            },
          })}\n`;
        yield* it.files.writeFileString(
          it.path,
          `${JSON.stringify({ thread: { id: it.threadId }, facet: null, session: null })}\n${fat(1, 'a')}${fat(2, 'b')}`,
        );
        expect(Number((yield* it.files.stat(it.path)).size)).toBeGreaterThan(stale);
        const healed = yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        expect(healed.reason).toBe('ok');
        expect((yield* it.cursor())?.nextByteOffset).toBe(Number((yield* it.files.stat(it.path)).size));
        expect((yield* it.rows()).map((row) => row.position).sort()).toEqual([1, 2]);
      }),
    ),
  );
});

describe('a refused rollout is a standing row', () => {
  const refusal = Effect.fnUntraced(function* (it: Effect.Success<ReturnType<typeof stand>>) {
    return yield* Effect.provide(
      Effect.flatMap(Effect.flip(it.projection.run({ threadId: it.threadId, path: it.path })), (failure) =>
        Effect.as(it.projection.record(failure), failure),
      ),
      it.runtime,
    );
  });

  it.live('the row carries the thread, the verdict and the cursor the pass stood on', () =>
    standing(
      Effect.fnUntraced(function* (it) {
        yield* it.append(1, 'a');
        yield* it.append(2, 'b');
        yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        const stood = yield* it.cursor();
        yield* it.append(2, 'again');
        const failure = yield* refusal(it);
        expect(failure.reason).toBe('out-of-order');
        const [row, ...rest] = yield* it.refusals();
        expect(rest).toEqual([]);
        expect(row?.threadId).toBe(it.threadId);
        expect(row?.reason).toBe('out-of-order');
        expect(row?.nextByteOffset).toBe(stood?.nextByteOffset ?? -1);
        expect(row?.nextPosition).toBe(3);
        expect(row?.message).toBe(failure.message);
      }),
    ),
  );

  it.live('a second boot meeting the same disagreement leaves one row, not two', () =>
    standing(
      Effect.fnUntraced(function* (it) {
        yield* it.append(1, 'a');
        yield* it.append(3, 'c');
        const first = yield* refusal(it);
        const stored = (yield* it.refusals())[0];
        const second = yield* refusal(it);
        expect(second.reason).toBe(first.reason);
        const rows = yield* it.refusals();
        expect(rows.length).toBe(1);
        expect(rows[0]?.reason).toBe(stored?.reason);
        expect(rows[0]?.nextPosition).toBe(stored?.nextPosition);
        expect(rows[0]?.seenAt.getTime()).toBeGreaterThanOrEqual(stored?.seenAt.getTime() ?? 0);
      }),
    ),
  );

  it.live('the pass that carries the file again takes the row away, and reading it never does', () =>
    standing(
      Effect.fnUntraced(function* (it) {
        yield* it.append(1, 'a');
        yield* it.appendText('this is not json at all\n');
        yield* refusal(it);
        expect((yield* it.refusals()).length).toBe(1);
        expect((yield* Effect.provide(it.projection.refusal(it.threadId), it.runtime))?.reason).toBe('corrupt');
        expect((yield* it.refusals()).length).toBe(1);
        yield* it.files.writeFileString(it.path, `${JSON.stringify({ thread: { id: it.threadId }, facet: null, session: null })}\n`);
        yield* it.append(1, 'a');
        yield* it.append(2, 'b');
        const healed = yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        expect(healed.reason).toBe('ok');
        expect(yield* it.refusals()).toEqual([]);
        expect(yield* Effect.provide(it.projection.refusal(it.threadId), it.runtime)).toBeUndefined();
      }),
    ),
  );

  it.live('a thread whose rollout was never refused has no row at all', () =>
    standing(
      Effect.fnUntraced(function* (it) {
        yield* it.append(1, 'a');
        yield* outcome(it.projection.run({ threadId: it.threadId, path: it.path }));
        expect(yield* it.refusals()).toEqual([]);
      }),
    ),
  );
});
