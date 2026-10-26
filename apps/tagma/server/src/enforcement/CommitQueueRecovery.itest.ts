import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Deferred, Effect, FileSystem } from 'effect';
import { commitQueue, type CommitQueue, type QueuedCommit } from './commits/queue.js';
import type { JournalAsk, JournalReady, JournalReply } from './commits/journal.js';

type Fault = {
  readonly kind: 'open' | 'admit' | 'settle';
  readonly at: 'before' | 'stored';
  readonly event?: 'error' | 'messageerror';
};
const queued = (commit: string): QueuedCommit => ({ op: 'git_commit', projectId: 1, root: '/checkout', commit, holder: 'operator' });
const home = Effect.flatMap(FileSystem.FileSystem, (files) => files.makeTempDirectoryScoped({ prefix: 'commit-recovery-' }));
const idle = (queue: CommitQueue['Service']) =>
  Effect.repeat(Effect.andThen(Effect.sleep(1), queue.drained()), { until: (state) => state.waiting === 0 });

const faults = Effect.gen(function* () {
  const ActualWorker = globalThis.Worker;
  let pending: Fault[] = [];
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      globalThis.Worker = class extends ActualWorker {
        private request: JournalAsk | undefined;
        constructor(...input: ConstructorParameters<typeof ActualWorker>) {
          super(...input);
          this.addEventListener('message', (event: MessageEvent<JournalReply | JournalReady>) => {
            const fault = pending[0];
            if (fault?.at !== 'stored' || this.request?.kind !== fault.kind || event.data.kind !== 'stored') return;
            pending.shift();
            event.stopImmediatePropagation();
            if (fault.event !== undefined) this.dispatchEvent(new Event(fault.event));
            this.terminate();
          });
        }
        override postMessage(message: unknown): void {
          const request = message as JournalAsk;
          this.request = request;
          const fault = pending[0];
          if (fault?.at === 'before' && request.kind === fault.kind) {
            pending.shift();
            if (fault.event !== undefined) this.dispatchEvent(new Event(fault.event));
            this.terminate();
          } else super.postMessage(message);
        }
      };
    }),
    () =>
      Effect.sync(() => {
        globalThis.Worker = ActualWorker;
      }),
  );
  return (...next: Fault[]) => {
    pending = next;
  };
});

layer(BunFileSystem.layer, { excludeTestServices: true })('commit queue worker recovery', (it) => {
  it.effect('a worker lost before append refuses that commit, then admits without losing the durable backlog or unread line', () =>
    Effect.gen(function* () {
      const path = join(yield* home, 'before.jsonl');
      const unread = '{"torn":';
      writeFileSync(path, `${JSON.stringify({ seq: 5, queued: queued('held') })}\n${unread}\n`);
      const arm = yield* faults;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* commitQueue({ path, judge: () => Effect.never });
          arm({ kind: 'admit', at: 'before', event: 'messageerror' });
          expect((yield* Effect.flip(queue.admit(queued('lost'))))._tag).toBe('CommitAdmissionRefused');
          expect(yield* queue.admit(queued('later'))).toBe(2);
          yield* queue.close();
          expect(yield* queue.drained()).toEqual({ waiting: 2, unread: 1 });
        }),
      );
      const rows = readFileSync(path, 'utf8').trimEnd().split('\n');
      expect(rows).toContain(unread);
      const records = rows.filter((row) => row !== unread).map((row) => JSON.parse(row) as { seq: number; queued: QueuedCommit });
      expect(records.map((record) => record.queued.commit)).toEqual(['held', 'later']);
      expect(records[1]!.seq).toBeGreaterThan(6);
    }),
  );

  it.effect('a durable append with no ACK rejoins the running judgement once, and close still orders behind recovery', () =>
    Effect.gen(function* () {
      const path = join(yield* home, 'append.jsonl');
      writeFileSync(path, `${JSON.stringify({ seq: 0, queued: queued('running') })}\n{"unread":\n`);
      const arm = yield* faults;
      const reached = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const judged: string[] = [];
      yield* Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* commitQueue({
            path,
            judge: Effect.fnUntraced(function* (one: QueuedCommit) {
              judged.push(one.commit);
              if (one.commit === 'running') {
                yield* Deferred.succeed(reached, undefined);
                yield* Deferred.await(release);
              }
            }),
          });
          yield* Deferred.await(reached);
          arm({ kind: 'admit', at: 'stored', event: 'error' });
          const [refused] = yield* Effect.all([Effect.flip(queue.admit(queued('durable'))), queue.close()], { concurrency: 2 });
          expect(refused._tag).toBe('CommitAdmissionRefused');
          expect((yield* Effect.flip(queue.admit(queued('closed'))))._tag).toBe('CommitAdmissionRefused');
          yield* queue.reopen();
          expect(yield* queue.admit(queued('later'))).toBe(3);
          yield* Deferred.succeed(release, undefined);
          yield* idle(queue);
          expect(yield* queue.drained()).toEqual({ waiting: 0, unread: 1 });
        }),
      );
      expect(judged).toEqual(['running', 'durable', 'later']);
      expect(readFileSync(path, 'utf8')).toContain('{"unread":');
    }),
  );

  for (const unread of [false, true]) {
    it.effect(
      `a durable ${unread ? 'settlement marker' : 'empty journal'} with no ACK clears its outstanding count without rejudgement`,
      () =>
        Effect.gen(function* () {
          const path = join(yield* home, 'settle.jsonl');
          writeFileSync(path, unread ? '{"unread":\n' : '');
          const arm = yield* faults;
          const reached = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const judged: string[] = [];
          yield* Effect.scoped(
            Effect.gen(function* () {
              const queue = yield* commitQueue({
                path,
                judge: Effect.fnUntraced(function* (one: QueuedCommit) {
                  judged.push(one.commit);
                  if (one.commit === 'settled') {
                    yield* Deferred.succeed(reached, undefined);
                    yield* Deferred.await(release);
                  }
                }),
              });
              yield* queue.admit(queued('settled'));
              yield* Deferred.await(reached);
              arm({ kind: 'settle', at: 'stored' });
              yield* Deferred.succeed(release, undefined);
              yield* idle(queue);
              expect(yield* queue.admit(queued('later'))).toBe(1);
              yield* idle(queue);
              expect(yield* queue.drained()).toEqual({ waiting: 0, unread: Number(unread) });
            }),
          );
          expect(judged).toEqual(['settled', 'later']);
          const replayed: string[] = [];
          const queue = yield* commitQueue({
            path,
            judge: (one) =>
              Effect.sync(() => {
                replayed.push(one.commit);
              }),
          });
          expect(yield* queue.drained()).toEqual({ waiting: 0, unread: Number(unread) });
          expect(replayed).toEqual([]);
        }),
    );
  }

  it.effect('an unsettled successful judgement remains counted across recovery and replays only after the scope ends', () =>
    Effect.gen(function* () {
      const path = join(yield* home, 'unstruck.jsonl');
      const arm = yield* faults;
      const reached = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const judged: string[] = [];
      yield* Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* commitQueue({
            path,
            judge: Effect.fnUntraced(function* (one: QueuedCommit) {
              judged.push(one.commit);
              if (one.commit === 'unstruck') {
                yield* Deferred.succeed(reached, undefined);
                yield* Deferred.await(release);
              }
            }),
          });
          yield* queue.admit(queued('unstruck'));
          yield* Deferred.await(reached);
          arm({ kind: 'settle', at: 'before' });
          yield* Deferred.succeed(release, undefined);
          yield* queue.close();
          yield* queue.reopen();
          yield* queue.admit(queued('later'));
          yield* Effect.repeat(Effect.andThen(Effect.sleep(1), queue.drained()), { until: (state) => state.waiting === 1 });
          expect(yield* queue.drained()).toEqual({ waiting: 1, unread: 0 });
          expect(judged).toEqual(['unstruck', 'later']);
        }),
      );
      const replayed: string[] = [];
      const queue = yield* commitQueue({
        path,
        judge: (one) =>
          Effect.sync(() => {
            replayed.push(one.commit);
          }),
      });
      yield* idle(queue);
      expect(replayed).toEqual(['unstruck']);
      expect(readFileSync(path, 'utf8')).toBe('');
    }),
  );

  it.effect('an admission with no ACK blocks draining while restoration fails, then rejoins the durable queue', () =>
    Effect.gen(function* () {
      const path = join(yield* home, 'unavailable.jsonl');
      const arm = yield* faults;
      const queue = yield* commitQueue({ path, judge: () => Effect.never });
      arm({ kind: 'admit', at: 'stored' }, { kind: 'open', at: 'before' });
      expect((yield* Effect.flip(queue.admit(queued('durable'))))._tag).toBe('CommitAdmissionRefused');
      expect(yield* queue.drained()).toEqual({ waiting: 1, unread: 0 });
      yield* queue.close();
      expect(yield* queue.drained()).toEqual({ waiting: 1, unread: 0 });
      yield* queue.reopen();
      expect(yield* queue.admit(queued('later'))).toBe(2);
      const records = readFileSync(path, 'utf8')
        .trimEnd()
        .split('\n')
        .map((row) => JSON.parse(row) as { seq: number; queued: QueuedCommit });
      expect(records.map((record) => record.queued.commit)).toEqual(['durable', 'later']);
      expect(new Set(records.map((record) => record.seq)).size).toBe(2);
    }),
  );
});
