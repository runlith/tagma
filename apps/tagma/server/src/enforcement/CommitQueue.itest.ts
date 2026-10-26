import { expect, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Deferred, Effect, FileSystem } from 'effect';
import { commitQueue, type QueuedCommit, RECORD_BACKLOG, CommitRecordFailed } from './commits/queue.js';

const queued = (commit: string): QueuedCommit => ({ op: 'git_commit', projectId: 1, root: '/checkout', commit, holder: 'operator' });

const home = Effect.flatMap(FileSystem.FileSystem, (files) => files.makeTempDirectoryScoped({ prefix: 'commit-queue-' }));

const emptied = (path: string) =>
  Effect.asVoid(
    Effect.repeat(
      Effect.andThen(
        Effect.sleep(10),
        Effect.sync(() => readFileSync(path, 'utf8')),
      ),
      { until: (text) => text === '' },
    ),
  );

layer(BunFileSystem.layer, { excludeTestServices: true })('commit queue file', (it) => {
  it.effect('commits beyond a torn line replay in order while the unread line remains for downgrade preflight', () =>
    Effect.gen(function* () {
      const path = join(yield* home, 'restart.jsonl');
      writeFileSync(path, `${JSON.stringify({ seq: 0, queued: queued('a0') })}\n{"seq":1,"queu`);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* commitQueue({ path, judge: () => Effect.never });
          expect(yield* queue.admit(queued('b2'))).toBe(2);
        }),
      );

      const judged: string[] = [];
      const drained = yield* Deferred.make<void>();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* commitQueue({
            path,
            judge: (one) =>
              Effect.suspend(() => {
                judged.push(one.commit);
                return judged.length === 3 ? Effect.asVoid(Deferred.succeed(drained, undefined)) : Effect.void;
              }),
          });
          yield* queue.admit(queued('c3'));
          yield* Deferred.await(drained);
          yield* Effect.repeat(Effect.andThen(Effect.sleep(10), queue.drained()), { until: (state) => state.waiting === 0 });
          expect(yield* queue.drained()).toEqual({ waiting: 0, unread: 1 });
        }),
      );
      expect(judged).toEqual(['a0', 'b2', 'c3']);
      expect(readFileSync(path, 'utf8')).toContain('{"seq":1,"queu');
    }),
  );

  it.effect('a commit whose judgement failed stays first and is judged again when the next commit is handed over', () =>
    Effect.gen(function* () {
      const path = join(yield* home, 'retry.jsonl');
      const judged: string[] = [];
      const both = yield* Deferred.make<void>();
      const failing = yield* Deferred.make<void>();
      let tries = 0;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* commitQueue({
            path,
            judge: (one) =>
              Effect.suspend(() => {
                judged.push(one.commit);
                if (one.commit === 'x1' && (tries += 1) === 1)
                  return Effect.andThen(
                    Deferred.succeed(failing, undefined),
                    Effect.fail(new CommitRecordFailed({ reason: 'the graph did not open' })),
                  );
                return judged.length === 3 ? Effect.asVoid(Deferred.succeed(both, undefined)) : Effect.void;
              }),
          });
          yield* queue.admit(queued('x1'));
          yield* Deferred.await(failing);
          yield* queue.admit(queued('y2'));
          yield* Deferred.await(both);
          yield* emptied(path);
        }),
      );
      expect(judged).toEqual(['x1', 'x1', 'y2']);
    }),
  );

  it.effect(
    'lines written with terminal callers and with actor callers replay alike in the order they were queued, each caller read as an actor',
    () =>
      Effect.gen(function* () {
        const path = join(yield* home, 'carriers.jsonl');
        const line = (seq: number, commit: string, caller: unknown) =>
          JSON.stringify({ seq, queued: { ...queued(commit), holder: `h${seq}`, caller } });
        writeFileSync(
          path,
          [
            line(0, 't0', { _tag: 'Thread', threadId: 'thread-a', projectId: 1 }),
            line(1, 'f1', { _tag: 'Foreign', harness: 'claude-code', key: 'k1', projectId: 1 }),
            line(2, 'o2', { _tag: 'Operator' }),
            line(3, 'n3', { kind: 'session', session: { harness: 'codex', key: 'k3' }, projectId: 1 }),
            line(4, 'd4', { kind: 'operator' }),
            JSON.stringify({ done: 4 }),
            '',
          ].join('\n'),
        );
        const judged: QueuedCommit[] = [];
        const all = yield* Deferred.make<void>();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const queue = yield* commitQueue({
              path,
              judge: (one) =>
                Effect.suspend(() => {
                  judged.push(one);
                  return judged.length === 5 ? Effect.asVoid(Deferred.succeed(all, undefined)) : Effect.void;
                }),
            });
            yield* queue.admit({ ...queued('a5'), caller: { kind: 'thread', threadId: 'thread-b', projectId: 1 } });
            yield* Deferred.await(all);
            yield* emptied(path);
          }),
        );
        expect(judged.map((one) => [one.commit, one.holder, one.caller])).toEqual([
          ['t0', 'h0', { kind: 'thread', threadId: 'thread-a', projectId: 1 }],
          ['f1', 'h1', { kind: 'session', session: { harness: 'claude-code', key: 'k1' }, projectId: 1 }],
          ['o2', 'h2', { kind: 'operator' }],
          ['n3', 'h3', { kind: 'session', session: { harness: 'codex', key: 'k3' }, projectId: 1 }],
          ['a5', 'operator', { kind: 'thread', threadId: 'thread-b', projectId: 1 }],
        ]);
      }),
  );

  it.effect(
    'a closed queue refuses admissions and reports the waiting and unread lines a restart found, so a downgrade is held back by a line no reader understands',
    () =>
      Effect.gen(function* () {
        const path = join(yield* home, 'closed.jsonl');
        yield* Effect.scoped(
          Effect.gen(function* () {
            const queue = yield* commitQueue({ path, judge: () => Effect.never });
            yield* queue.admit(queued('w0'));
            yield* queue.close();
            const refused = yield* Effect.flip(queue.admit(queued('late')));
            expect(refused._tag).toBe('CommitAdmissionRefused');
          }),
        );
        writeFileSync(
          path,
          `${readFileSync(path, 'utf8')}${JSON.stringify({ seq: 9, queued: { ...queued('x'), caller: { kind: 'robot' } } })}\n`,
        );

        yield* Effect.scoped(
          Effect.gen(function* () {
            const queue = yield* commitQueue({ path, judge: () => Effect.never });
            yield* queue.close();
            expect(yield* queue.drained()).toEqual({ waiting: 1, unread: 1 });
          }),
        );
      }),
  );

  it.effect('compaction keeps unread and concurrently admitted commits durable without file I/O on the calling loop', () =>
    Effect.gen(function* () {
      const path = join(yield* home, 'compacted.jsonl');
      const unread = '{"unread":';
      const first = { ...queued('first'), projectId: 1 };
      const held = { ...queued('held'), projectId: 2 };
      const late = { ...queued('late'), projectId: 3 };
      writeFileSync(
        path,
        [
          ...Array.from({ length: 63 }, (_, done) => JSON.stringify({ done })),
          JSON.stringify({ seq: 63, queued: first }),
          JSON.stringify({ seq: 64, queued: held }),
          unread,
          '',
        ].join('\n'),
      );
      const attempted = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      const reached = yield* Deferred.make<void>();
      const noLoopIO = () => {
        throw new Error('commit journal I/O belongs to its worker');
      };
      const reading = spyOn(fs, 'readFileSync').mockImplementation(noLoopIO);
      const writing = spyOn(fs, 'writeFileSync').mockImplementation(noLoopIO);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* commitQueue({
            path,
            judge: (one) =>
              one.commit === first.commit
                ? Effect.andThen(Deferred.succeed(attempted, undefined), Deferred.await(released))
                : Effect.andThen(Deferred.succeed(reached, undefined), Effect.never),
          });
          yield* Deferred.await(attempted);
          yield* Effect.all([queue.admit(late), Deferred.succeed(released, undefined)], { concurrency: 2 });
          yield* Deferred.await(reached);
          yield* queue.close();
          expect(yield* queue.drained()).toEqual({ waiting: 2, unread: 1 });
        }),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            reading.mockRestore();
            writing.mockRestore();
          }),
        ),
      );
      const rows = readFileSync(path, 'utf8').trimEnd().split('\n');
      expect(rows).toHaveLength(3);
      expect(rows).toContain(unread);
      const replayed: string[] = [];
      yield* Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* commitQueue({
            path,
            judge: (one) =>
              Effect.sync(() => {
                replayed.push(one.commit);
              }),
          });
          yield* Effect.repeat(Effect.andThen(Effect.sleep(10), queue.drained()), { until: (state) => state.waiting === 0 });
          expect(yield* queue.drained()).toEqual({ waiting: 0, unread: 1 });
        }),
      );
      expect(replayed).toEqual([held.commit, late.commit]);
    }),
  );

  it.effect('a queue holding its ceiling refuses the next commit instead of promising to record it', () =>
    Effect.gen(function* () {
      const queue = yield* commitQueue({ path: null, judge: () => Effect.never });
      for (let at = 0; at < RECORD_BACKLOG; at += 1) yield* queue.admit(queued(`c${at}`));
      const refused = yield* Effect.flip(queue.admit(queued('over')));
      expect(refused._tag).toBe('CommitAdmissionRefused');
    }),
  );
});
