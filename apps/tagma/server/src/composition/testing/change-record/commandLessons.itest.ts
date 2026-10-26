import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { writeFileSync } from 'node:fs';
import { Clock, Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { contentDigest } from '@runlith/files/content';
import type { CommandFacts, CommandMove } from '@runlith/agent-tools/WorkspaceChanges';
import { changeRecordOf, commandLives, commandRig, journalOf, lessonsOf } from '../../../change-record/testing/doubles.js';
import { recoverCommands } from '../../../change-record/record/recovery.js';
import { READER_RUNS, WRITER_HITS } from '../../../change-record/record/lessons.js';
import { CommandWalks, commandWalksLayer } from './commandWorld.js';
import { gitCheckoutPaths } from '../../../workspace/testing/doubles.js';
import { MINE, makeCheckout, checkoutFixture, withCheckout } from '../checkoutFixture.js';

const part = (signature: string, listed: boolean) => ({ readsOnly: false, named: listed ? [] : null, signature, listed, implicit: [] });

const line = (...parts: ReturnType<typeof part>[]): CommandFacts => ({ readsOnly: false, parts });

const server = Effect.fnUntraced(function* (w: Effect.Success<ReturnType<typeof makeCheckout>>) {
  const walks = yield* CommandWalks;
  const paths = gitCheckoutPaths('repo-root', w.projectId);
  const lives = commandLives();
  const lessons = yield* lessonsOf(w.store, w.units, 'repo');
  const { commands, intake } = yield* commandRig({ store: w.store, units: w.units, git: w.git, walks, lives, paths, lessons });
  const record = yield* changeRecordOf(w.store, w.units, paths, intake, commands, walks);
  const journal = yield* journalOf(w.store, w.units, walks);
  const run = Effect.fnUntraced(function* (facts: CommandFacts, write: string | null) {
    const life = yield* (
      record.changes({ work: { projectId: w.projectId, threadId: MINE } }).command?.(w.root, facts) ?? Effect.succeed(null)
    );
    if (life === null || life === undefined) return yield* Effect.die('the checkout opened no command window');
    const windows = yield* journal.windows();
    const role = windows[windows.length - 1]?.role;
    const from = yield* Clock.currentTimeMillis;
    life.opened();
    yield* Effect.sleep(30);
    const moves: CommandMove[] = [];
    if (write !== null) {
      const at = yield* Clock.currentTimeMillis;
      writeFileSync(w.file, write);
      moves.push({
        name: 'src/a.ts',
        before: null,
        after: contentDigest(write),
        present: true,
        existed: true,
        written: { from: at, to: at },
        bytes: null,
        link: false,
        mode: 0o100644,
      });
    }
    yield* Effect.sleep(30);
    life.ended();
    yield* life.settle({ base: null, window: { from, to: yield* Clock.currentTimeMillis }, moves });
    life.close();
    yield* Effect.sleep(30);
    return role;
  });
  const roleOpened = (facts: CommandFacts) => run(facts, null);
  const files = yield* FileSystem.FileSystem;
  const restart = () =>
    Effect.flatMap(Clock.currentTimeMillis, (at) => recoverCommands(w.store, w.units, files, journal, lives, commands, at));
  return { run, roleOpened, restart, journal, lessons };
});

layer(Layer.mergeAll(commandWalksLayer, BunFileSystem.layer, checkoutFixture), { excludeTestServices: true })('command lessons', (it) => {
  it.effect(
    'an unlisted signature becomes a reader after its clean runs and a listed one a writer after the writes it made alone, while a compound line teaches neither',
    () =>
      withCheckout((checkout) =>
        Effect.gen(function* () {
          const w = checkout;
          yield* w.namedAgent(MINE, { name: MINE, task: 'owned lines' });
          const s = yield* server(w);
          const docs = line(part('make docs', false));
          for (let at = 0; at < READER_RUNS; at++) yield* s.run(docs, null);
          expect(yield* s.roleOpened(docs)).toEqual({ kind: 'reader', implicit: [] });
          const check = line(part('bun test', true));
          const compound = line(part('bun test', true), part('make lint', false));
          for (let at = 0; at < WRITER_HITS; at++) yield* s.run(compound, `export const compound = ${at};\n`);
          expect(yield* s.roleOpened(check)).toEqual({ kind: 'reader', implicit: [] });
          for (let at = 0; at < WRITER_HITS; at++) yield* s.run(check, `export const alone = ${at};\n`);
          expect(yield* s.roleOpened(check)).toEqual({ kind: 'writer' });
        }),
      ),
  );
  it.effect('lessons outlive a restart, and a window decided again from the journal after it teaches nothing', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const w = checkout;
        yield* w.namedAgent(MINE, { name: MINE, task: 'owned lines' });
        const docs = line(part('make site', false));
        const before = yield* server(w);
        for (let at = 0; at < READER_RUNS - 1; at++) yield* before.run(docs, null);
        const at = yield* Clock.currentTimeMillis;
        yield* before.journal.opened({
          id: 'journaled',
          projectId: w.projectId,
          threadId: MINE,
          runHint: null,
          checkout: 'repo-root',
          spelling: w.root,
          openedAt: at,
          role: { kind: 'writer' },
          signatures: ['make site'],
          team: null,
        });
        yield* before.journal.settled('journaled', { start: at, end: at + 10 }, { from: at, to: at + 10 }, []);
        yield* before.lessons.ready;
        const after = yield* server(w);
        expect((yield* after.restart()).replayed).toBe(1);
        expect(yield* after.roleOpened(docs)).toEqual({ kind: 'writer' });
        expect(yield* after.roleOpened(docs)).toEqual({ kind: 'reader', implicit: [] });
      }),
    ),
  );
});
