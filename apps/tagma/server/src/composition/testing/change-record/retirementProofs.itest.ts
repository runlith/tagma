import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Deferred, Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { changeOf } from '@runlith/files/change';
import { replaced } from '@runlith/files/replace';
import { idleCommands, intakeOf, journalOf, WRITER_WINDOW } from '../../../change-record/testing/doubles.js';
import { OPERATOR } from '../../../workspace/contract/wire/checkout.js';
import { CommandWalks } from './commandWorld.js';
import { holdingsOver } from '../../../change-record/testing/holdings.js';
import { releasedAt } from '../../../change-record/record/released.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { gitCheckoutPaths, TEST_CHECKOUT } from '../../../workspace/testing/doubles.js';
import { MINE, THEIRS } from '../checkoutFixture.js';
import { lines, retirementFixture, withRetirement } from '../retirementFixture.js';

const CHECKOUT = RootId.make(TEST_CHECKOUT);

layer(retirementFixture, { excludeTestServices: true })('retirement proofs', (it) => {
  it.effect('a clean verdict arriving after the HEAD pass retires the row without another HEAD move', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        const walks = yield* CommandWalks;
        yield* s.w.wrote(MINE, lines([1, 'const two = 200;']));
        yield* s.rig.holdings.judged(CHECKOUT, ['src/a.ts']);
        yield* s.pass();
        yield* s.w.run(['checkout', '--', 'src/a.ts']);
        const moved = yield* s.aside('unrelated.txt');
        yield* s.pass();

        const judged = yield* s.rig.holdings.judged(CHECKOUT, ['src/a.ts']);
        expect(judged.get('src/a.ts')?.holding.git).toBeNull();
        yield* s.pass();

        expect(yield* s.w.run(['rev-parse', 'HEAD'])).toBe(moved);
        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'withdrawn', commit: null, reason: 'reverted' }]);
      }),
    ),
  );

  it.effect('a return to an unchanged HEAD keeps its row for a later restoration', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        const walks = yield* CommandWalks;
        yield* s.w.wrote(MINE, lines([1, 'const two = 200;']));
        yield* s.pass();
        yield* s.w.run(['checkout', '--', 'src/a.ts']);
        yield* s.rig.holdings.judged(CHECKOUT, ['src/a.ts']);

        yield* s.pass();

        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'held', commit: null, reason: null }]);
      }),
    ),
  );

  it.effect('closing a command window lets a previously deferred carrying commit release the row', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        const walks = yield* CommandWalks;
        yield* s.w.wrote(MINE, lines([4, 'const five = 50;']));
        yield* s.pass();
        const journal = yield* journalOf(s.w.store, s.w.units, walks);
        yield* journal.opened({
          id: 'window',
          projectId: s.w.projectId,
          threadId: MINE,
          runHint: null,
          checkout: TEST_CHECKOUT,
          spelling: s.w.root,
          openedAt: yield* Clock.currentTimeMillis,
          ...WRITER_WINDOW,
        });
        const carrying = yield* s.commit('carry while the command runs', 'src/a.ts');
        yield* s.pass();
        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'held', commit: null, reason: null }]);
        yield* journal.closed(['window']);

        yield* s.pass();

        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'committed', commit: carrying, reason: null }]);
      }),
    ),
  );

  it.effect('an overwritten row protected by a command window leaves as overwritten after the driver is restored', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        const walks = yield* CommandWalks;
        yield* s.w.wrote(MINE, lines([3, 'const four = 40;']));
        yield* s.w.wrote(THEIRS, lines([3, 'const four = 400;']));
        yield* s.pass();
        const journal = yield* journalOf(s.w.store, s.w.units, walks);
        yield* journal.opened({
          id: 'window',
          projectId: s.w.projectId,
          threadId: MINE,
          runHint: null,
          checkout: TEST_CHECKOUT,
          spelling: s.w.root,
          openedAt: yield* Clock.currentTimeMillis,
          ...WRITER_WINDOW,
        });
        const carrying = yield* s.commit('carry the overwriter', 'src/a.ts');
        yield* s.pass();
        expect(yield* s.rowsOf(THEIRS)).toEqual([{ state: 'committed', commit: carrying, reason: null }]);
        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'held', commit: null, reason: null }]);
        yield* journal.closed(['window']);
        const restored = yield* holdingsOver(s.w.store, s.w.units, s.w.git, s.w.root, walks);

        yield* restored.retirement.pass(CHECKOUT);

        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'withdrawn', commit: null, reason: 'overwritten' }]);
        const witnesses = yield* releasedAt(s.w.units, s.w.store, TEST_CHECKOUT, ['src/a.ts']);
        expect(witnesses.get('src/a.ts')?.map((one) => [one.thread, one.reason])).toEqual([[MINE, 'overwritten']]);
      }),
    ),
  );

  it.effect('a deferred row on another path does not erase an overwritten witness on repeated passes', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        const walks = yield* CommandWalks;
        yield* s.w.wrote(THEIRS, lines([3, 'const four = 40;']));
        yield* s.w.wrote('overwriter', lines([3, 'const four = 400;']));
        const text = 'export const deferred = true;\n';
        writeFileSync(join(s.w.root, 'src', 'deferred.ts'), text);
        yield* s.w.record(MINE, '', text, { path: 'src/deferred.ts', origin: 'write' });
        yield* s.pass();
        const journal = yield* journalOf(s.w.store, s.w.units, walks);
        yield* journal.opened({
          id: 'window',
          projectId: s.w.projectId,
          threadId: MINE,
          runHint: null,
          checkout: TEST_CHECKOUT,
          spelling: s.w.root,
          openedAt: yield* Clock.currentTimeMillis,
          ...WRITER_WINDOW,
        });
        yield* s.commit('carry both paths', 'src/a.ts', 'src/deferred.ts');
        yield* s.pass();
        yield* s.pass();
        yield* journal.closed(['window']);
        yield* s.pass();

        expect(yield* s.rowsOf(THEIRS)).toEqual([{ state: 'withdrawn', commit: null, reason: 'overwritten' }]);
        const witnesses = yield* releasedAt(s.w.units, s.w.store, TEST_CHECKOUT, ['src/a.ts']);
        expect(witnesses.get('src/a.ts')?.map((one) => [one.thread, one.reason])).toEqual([[THEIRS, 'overwritten']]);
      }),
    ),
  );

  it.effect('a deferred proof stops naming a commit after the branch no longer reaches it', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        const walks = yield* CommandWalks;
        const base = yield* s.w.run(['rev-parse', 'HEAD']);
        yield* s.w.wrote(MINE, lines([4, 'const five = 50;']));
        yield* s.pass();
        const journal = yield* journalOf(s.w.store, s.w.units, walks);
        yield* journal.opened({
          id: 'window',
          projectId: s.w.projectId,
          threadId: MINE,
          runHint: null,
          checkout: TEST_CHECKOUT,
          spelling: s.w.root,
          openedAt: yield* Clock.currentTimeMillis,
          ...WRITER_WINDOW,
        });
        yield* s.commit('carry before reset', 'src/a.ts');
        yield* s.pass();
        yield* s.w.run(['reset', '--hard', base]);
        yield* journal.closed(['window']);

        yield* s.pass();

        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'withdrawn', commit: null, reason: 'reverted' }]);
      }),
    ),
  );

  it.effect('an operator save joined during the verdict stays held until the commit carrying its new bytes', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        const walks = yield* CommandWalks;
        const intake = yield* intakeOf(s.w.store, s.w.units, s.w.git, gitCheckoutPaths(TEST_CHECKOUT), { walks });
        const save = (after: string) =>
          intake
            .turn(
              s.w.projectId,
              [s.w.file],
              Effect.gen(function* () {
                const bytes = new Uint8Array(readFileSync(s.w.file));
                const before = new TextDecoder().decode(bytes);
                const fact = changeOf('edit', s.w.file, { bytes }, before, after, false, new Date(yield* Clock.currentTimeMillis));
                return yield* intake.land({ projectId: s.w.projectId, holder: OPERATOR }, [fact], replaced(s.w.file, { bytes }, after));
              }),
            )
            .pipe(Effect.provide(BunFileSystem.layer));
        const committed = `${lines([0, 'const one = 10;']).join('\n')}\n`;
        const updated = `${lines([0, 'const one = 10;'], [1, 'const two = 20;']).join('\n')}\n`;
        yield* save(committed);
        yield* s.pass();
        yield* s.commit('carry the first operator save', 'src/a.ts');
        let saved = false;
        const git: Git['Service'] = {
          run: (args, options) => {
            if (!saved && args.includes('check-attr')) {
              saved = true;
              return Effect.andThen(save(updated).pipe(Effect.orDie), s.w.git.run(args, options));
            }
            return s.w.git.run(args, options);
          },
        };
        const rig = yield* holdingsOver(s.w.store, s.w.units, git, s.w.root, walks);
        yield* rig.retirement.pass(CHECKOUT);
        yield* rig.retirement.pass(CHECKOUT);
        expect(yield* s.rowsOf('operator')).toEqual([{ state: 'held', commit: null, reason: null }]);
        expect(readFileSync(s.w.file, 'utf8')).toBe(updated);
        const carrying = yield* s.commit('carry the joined operator save', 'src/a.ts');

        yield* rig.retirement.pass(CHECKOUT);

        expect(yield* s.rowsOf('operator')).toEqual([{ state: 'committed', commit: carrying, reason: null }]);
      }),
    ),
  );

  it.effect('the started driver releases a deferred proof when the command window closes, without another HEAD move', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        const walks = yield* CommandWalks;
        const journal = yield* journalOf(s.w.store, s.w.units, walks);
        const released = yield* Deferred.make<void>();
        const rig = yield* holdingsOver(
          s.w.store,
          s.w.units,
          s.w.git,
          s.w.root,
          walks,
          (change) => (change.outcomes === true ? Effect.void : Effect.asVoid(Deferred.succeed(released, undefined))),
          undefined,
          yield* idleCommands(journal),
        );
        yield* rig.retirement.start;
        yield* s.w.wrote(MINE, lines([4, 'const five = 50;']));
        yield* rig.retirement.pass(CHECKOUT);
        yield* journal.opened({
          id: 'window',
          projectId: s.w.projectId,
          threadId: MINE,
          runHint: null,
          checkout: TEST_CHECKOUT,
          spelling: s.w.root,
          openedAt: yield* Clock.currentTimeMillis,
          ...WRITER_WINDOW,
        });
        const carrying = yield* s.commit('carry before automatic retirement', 'src/a.ts');
        yield* rig.retirement.pass(CHECKOUT);
        yield* journal.closed(['window']);

        yield* Deferred.await(released).pipe(Effect.timeout('2 seconds'));

        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'committed', commit: carrying, reason: null }]);
      }),
    ),
  );

  it.effect('a command window opened during the verdict preserves the carrying commit for a later pass', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        const walks = yield* CommandWalks;
        yield* s.w.wrote(MINE, lines([4, 'const five = 50;']));
        yield* s.pass();
        const carrying = yield* s.commit('carry before the command opens', 'src/a.ts');
        const journal = yield* journalOf(s.w.store, s.w.units, walks);
        let opened = false;
        const git: Git['Service'] = {
          run: Effect.fnUntraced(function* (args, options) {
            if (!opened && args.includes('check-attr')) {
              opened = true;
              yield* journal
                .opened({
                  id: 'late-window',
                  projectId: s.w.projectId,
                  threadId: MINE,
                  runHint: null,
                  checkout: TEST_CHECKOUT,
                  spelling: s.w.root,
                  openedAt: yield* Clock.currentTimeMillis,
                  ...WRITER_WINDOW,
                })
                .pipe(Effect.orDie);
            }
            return yield* s.w.git.run(args, options);
          }),
        };
        const rig = yield* holdingsOver(s.w.store, s.w.units, git, s.w.root, walks);
        yield* rig.retirement.pass(CHECKOUT);
        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'held', commit: null, reason: null }]);
        yield* journal.closed(['late-window']);

        yield* rig.retirement.pass(CHECKOUT);

        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'committed', commit: carrying, reason: null }]);
      }),
    ),
  );
});
