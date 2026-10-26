import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import type { ThreadEventRow } from '@runlith/agent/thread/storage/eventLog';
import { type RolloutWriter, rolloutWriter } from './rolloutWriter.js';
import { ROLLOUT_BLOCK } from './rolloutFile.js';

const home = (): string => mkdtempSync(join(tmpdir(), 'tagma-floor-'));

const event = (threadId: string, position: number, id: string) => ({ threadId, position, id, kind: 'message', payload: { entry: { id } } });

const born = (path: string, threadId: string): string => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ thread: { id: threadId }, facet: null, session: null })}\n`);
  return path;
};

const linesOf = (path: string): readonly { kind?: string; row?: { position: number; id: string } }[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((row) => row !== '')
    .map((row) => JSON.parse(row) as { kind?: string; row?: { position: number; id: string } });

const positions = (path: string): readonly number[] =>
  linesOf(path)
    .filter((line) => line.kind === 'event')
    .map((line) => line.row?.position ?? -1);

const writerAt = (path: string, pendingDir?: string) => rolloutWriter({ pathOf: () => path, birth: null, pendingDir });

const open = (floor: RolloutWriter, threadId: string, rows: readonly ThreadEventRow[] = []) =>
  floor.head(threadId, 5).pipe(Effect.flatMap((head) => floor.adopt(threadId, head ?? 0, rows)));

describe('the rollout carries every committed fact at its own number', () => {
  it.live('a born thread holds each carried fact on disk at the number the log gave it', () =>
    Effect.gen(function* () {
      const path = born(join(home(), '5', 't1.jsonl'), 't1');
      const floor = writerAt(path);

      yield* open(floor, 't1');
      yield* floor.carry('t1', [event('t1', 1, 'a')]);
      yield* floor.carry('t1', [event('t1', 2, 'b'), event('t1', 3, 'c')]);

      expect(positions(path)).toEqual([1, 2, 3]);
    }),
  );

  it.live('a reopened floor continues after the head its file stands at', () =>
    Effect.gen(function* () {
      const path = born(join(home(), '5', 't2.jsonl'), 't2');
      const first = writerAt(path);
      yield* open(first, 't2');
      yield* first.carry('t2', [event('t2', 1, 'a'), event('t2', 2, 'b')]);

      const next = writerAt(path);
      yield* open(next, 't2');
      yield* next.carry('t2', [event('t2', 3, 'c')]);
      expect(positions(path)).toEqual([1, 2, 3]);
    }),
  );

  it.live('rows the file never received are carried in at their own numbers', () =>
    Effect.gen(function* () {
      const path = born(join(home(), '5', 't3.jsonl'), 't3');
      const floor = writerAt(path);

      yield* open(
        floor,
        't3',
        [1, 2, 3].map((position) => event('t3', position, `old-${position}`)),
      );
      yield* floor.carry('t3', [event('t3', 4, 'new')]);

      expect(positions(path)).toEqual([1, 2, 3, 4]);
    }),
  );

  it.live('a carry that does not follow the file head writes nothing and leaves the thread to its next open', () =>
    Effect.gen(function* () {
      const path = born(join(home(), '5', 't4.jsonl'), 't4');
      const floor = writerAt(path);
      yield* open(floor, 't4');

      yield* floor.carry('t4', [event('t4', 2, 'later')]);
      yield* floor.carry('t4', [event('t4', 1, 'earlier')]);
      expect(positions(path)).toEqual([]);
      expect(floor.unopened('t4')).toBe(true);

      yield* open(floor, 't4', [event('t4', 1, 'earlier'), event('t4', 2, 'later')]);
      expect(
        linesOf(path)
          .filter((line) => line.kind === 'event')
          .map((line) => line.row?.id),
      ).toEqual(['earlier', 'later']);
    }),
  );

  it.live('a carry finishing after another batch invalidated its head leaves the next open to catch up', () =>
    Effect.gen(function* () {
      const path = born(join(home(), 'racing.jsonl'), 'racing');
      const floor = writerAt(path);
      const rows = [1, 2, 3, 4].map((position) => event('racing', position, `event-${position}`));
      yield* open(floor, 'racing');
      yield* Effect.all([floor.carry('racing', rows.slice(0, 2)), floor.carry('racing', rows.slice(2))], { concurrency: 2 });
      yield* open(floor, 'racing', rows);
      expect(positions(path)).toEqual([1, 2, 3, 4]);
    }),
  );

  it.live('a torn tail is cut before the next append, never welded to it', () =>
    Effect.gen(function* () {
      const path = born(join(home(), '5', 't5.jsonl'), 't5');
      const floor = writerAt(path);
      yield* open(floor, 't5');
      yield* floor.carry('t5', [event('t5', 1, 'a')]);

      appendFileSync(path, '{"kind":"event","row":{"posi');

      const next = writerAt(path);
      yield* open(next, 't5');
      yield* next.carry('t5', [event('t5', 2, 'b')]);

      expect(positions(path)).toEqual([1, 2]);
    }),
  );

  it.live('a file whose first line is not meta is refused, never appended to', () =>
    Effect.gen(function* () {
      const root = home();
      const path = join(root, '5', 'orphan.jsonl');
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify({ kind: 'event', row: { position: 1, id: 'a' } })}\n`);

      const failure = yield* Effect.flip(writerAt(path).head('orphan', 5));
      expect(failure.reason).toBe('not-a-rollout');
    }),
  );

  it.live('a thread with no file yet is refused: the meta line is written by its birth', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(writerAt(join(home(), '5', 'absent.jsonl')).head('absent', 5));
      expect(failure.reason).toBe('io');
      expect(failure.message).toContain('does not exist yet');
    }),
  );

  it.live('losing an opened journal refuses the next carry without recreating its file, and gives the thread back to its next open', () =>
    Effect.gen(function* () {
      const path = born(join(home(), 'lost.jsonl'), 'lost');
      const floor = writerAt(path);
      yield* open(floor, 'lost');
      yield* floor.carry('lost', [event('lost', 1, 'first')]);
      rmSync(path);
      expect((yield* Effect.flip(floor.carry('lost', [event('lost', 2, 'second')]))).reason).toBe('io');
      expect(existsSync(path)).toBe(false);
      expect(floor.unopened('lost')).toBe(true);
    }),
  );

  it.live('a forgotten thread reads its head from the file again', () =>
    Effect.gen(function* () {
      const path = born(join(home(), '5', 't6.jsonl'), 't6');
      const floor = writerAt(path);
      yield* open(floor, 't6');
      yield* floor.carry('t6', [event('t6', 1, 'a')]);

      floor.forget('t6');
      born(path, 't6');

      yield* open(floor, 't6');
      yield* floor.carry('t6', [event('t6', 1, 'b')]);
      expect(positions(path)).toEqual([1]);
    }),
  );
});

it.live('reopening after a record wider than a block continues at the recorded head', () =>
  Effect.gen(function* () {
    const path = born(join(home(), 'wide.jsonl'), 'wide');
    const first = writerAt(path);
    yield* open(first, 'wide');
    yield* first.carry('wide', [event('wide', 1, 'x'.repeat(ROLLOUT_BLOCK + 1))]);
    const next = writerAt(path);
    yield* open(next, 'wide');
    yield* next.carry('wide', [event('wide', 2, 'after')]);
    expect(positions(path)).toEqual([1, 2]);
  }),
);

it.live('a corrupt whole record refuses reopening without accepting an older head', () =>
  Effect.gen(function* () {
    const path = born(join(home(), 'corrupt.jsonl'), 'corrupt');
    const floor = writerAt(path);
    yield* open(floor, 'corrupt');
    yield* floor.carry('corrupt', [event('corrupt', 1, 'before')]);
    appendFileSync(path, '{"kind":"event","row":{"position\n');
    const before = readFileSync(path, 'utf8');
    expect((yield* Effect.flip(writerAt(path).head('corrupt', 5))).reason).toBe('io');
    expect(readFileSync(path, 'utf8')).toBe(before);
  }),
);

it.live('a thread whose rollout grew is named pending before the line lands, and stays named until it is settled', () =>
  Effect.gen(function* () {
    const root = home();
    const path = born(join(root, '5', 'tp.jsonl'), 'tp');
    const pending = join(root, '.pending');
    const floor = writerAt(path, pending);

    expect(yield* floor.pendingRollouts()).toEqual([]);
    yield* open(floor, 'tp').pipe(Effect.flatMap(() => floor.carry('tp', [event('tp', 1, 'a')])));
    expect(yield* floor.pendingRollouts()).toEqual([{ threadId: 'tp', path }]);

    const restarted = writerAt(path, pending);
    expect(yield* restarted.pendingRollouts()).toEqual([{ threadId: 'tp', path }]);
    yield* restarted.unmark('tp');
    expect(yield* restarted.pendingRollouts()).toEqual([]);
    yield* open(restarted, 'tp').pipe(Effect.flatMap(() => restarted.carry('tp', [event('tp', 2, 'b')])));
    expect(yield* restarted.pendingRollouts()).toEqual([{ threadId: 'tp', path }]);
  }),
);
