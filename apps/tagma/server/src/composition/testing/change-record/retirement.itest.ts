import { readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Effect, FileSystem } from 'effect';
import { createTools } from '@runlith/agent-tools';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { recordOver } from '../landingServices.js';
import { CommandWalks } from './commandWorld.js';
import { holderKey } from '../../../workspace/contract/wire/checkout.js';
import { journalOf, recordWrite, WRITER_WINDOW } from '../../../change-record/testing/doubles.js';
import { releasedAt } from '../../../change-record/record/released.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { TEST_CHECKOUT, testPlace } from '../../../workspace/testing/doubles.js';
import { call, FILE, MINE, THEIRS } from '../checkoutFixture.js';
import { lines, retirementFixture, withRetirement } from '../retirementFixture.js';
import { contentDigest } from '@runlith/files/content';
import { insertRow } from '../../../change-record/record/intake.js';
import { changeLogWrites } from '../../../change-record/store/tables.js';

const CHECKOUT = RootId.make(TEST_CHECKOUT);

layer(retirementFixture, { excludeTestServices: true })('retirement', (it) => {
  it.effect('of five commits a pass reads, the one that carries the lines commits them', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        yield* s.w.wrote(MINE, lines([0, 'const one = 100;']));
        yield* s.pass();
        yield* s.aside('first.txt');
        yield* s.aside('second.txt');
        const carrying = yield* s.commit('carry the line', 'src/a.ts');
        yield* s.aside('fourth.txt');
        yield* s.aside('fifth.txt');

        yield* s.pass();

        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'committed', commit: carrying, reason: null }]);
      }),
    ),
  );

  it.effect('a commit a pass read is still walked when another commit moved HEAD before its lines were judged', () => {
    let armed = false;
    return withRetirement(
      (s) =>
        Effect.gen(function* () {
          yield* s.w.wrote(MINE, lines([0, 'const one = 100;']));
          yield* s.pass();
          const carrying = yield* s.commit('carry the line', 'src/a.ts');
          armed = true;
          yield* s.pass();
          yield* s.pass();

          expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'committed', commit: carrying, reason: null }]);
        }),
      (world) => ({
        ...world.git,
        run: (args, options) =>
          Effect.tap(world.git.run(args, options), () => {
            if (!armed || !args.includes('rev-parse') || !args.includes('HEAD^{commit}')) return Effect.void;
            armed = false;
            writeFileSync(join(world.root, 'beside.txt'), 'beside\n');
            return Effect.orDie(
              Effect.andThen(
                world.run(['add', '--', 'beside.txt']),
                world.run(['-c', 'user.name=h', '-c', 'user.email=h@h', 'commit', '-q', '-m', 'beside', '--', 'beside.txt']),
              ),
            );
          }),
      }),
    );
  });

  it.effect('lines returned to HEAD leave as reverted on the next move, not with a commit that never carried them', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        yield* s.w.wrote(MINE, lines([1, 'const two = 200;']));
        yield* s.pass();
        yield* s.w.run(['checkout', '--', 'src/a.ts']);
        yield* s.aside('unrelated.txt');

        yield* s.pass();

        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'withdrawn', commit: null, reason: 'reverted' }]);
      }),
    ),
  );

  it.effect('an overwritten line stays its writer’s while the overwriter holds it, and comes back when the overwriter reverts', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        yield* s.w.wrote(MINE, lines([2, 'const three = 30;']));
        yield* s.w.wrote(THEIRS, lines([2, 'const three = 300;']));
        yield* s.pass();
        yield* s.aside('third-thread.txt');
        yield* s.pass();
        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'held', commit: null, reason: null }]);

        yield* s.w.wrote(THEIRS, lines([2, 'const three = 30;']));
        const judged = yield* s.rig.holdings.judged(CHECKOUT, ['src/a.ts']);
        const verdict = judged.get('src/a.ts')?.holding.verdict;
        expect(verdict?.verdict === 'proven' ? verdict.hands.map((hand) => holderKey(hand.holder)) : verdict).toEqual([MINE]);
      }),
    ),
  );

  it.effect('a file written across a HEAD move, swapped to HEAD and back through write with a pass between, stays all its writer’s', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const scratch = yield* files.makeTempDirectoryScoped({ prefix: 'swap-' });
        const mine = createTools({
          cwd: s.w.root,
          world: makeMachineWorld(() => null),
          commandTimes: unruledTimes,
          searchMs: LONGEST_ACT_MS,
          allowOutsideCwd: true,
          changes: (yield* recordOver(s.w.store, s.w.units)).changes({ work: { projectId: s.w.projectId, threadId: MINE } }),
        });
        yield* call(mine.edit, { path: s.w.file, oldString: 'const one = 1;', newString: 'const one = 10;' });
        yield* s.aside('unrelated.txt');
        yield* s.pass();
        yield* call(mine.edit, { path: s.w.file, oldString: 'const three = 3;', newString: 'const three = 30;' });
        const own = join(scratch, 'own.ts');
        const head = join(scratch, 'head.ts');
        yield* files.writeFileString(own, readFileSync(s.w.file, 'utf8'));
        yield* files.writeFileString(head, `${FILE.join('\n')}\n`);

        yield* call(mine.write, { path: s.w.file, fromFile: head });
        yield* s.rig.holdings.moved(CHECKOUT, ['src/a.ts']);
        yield* s.rig.holdings.settled(CHECKOUT);
        yield* s.pass();
        yield* call(mine.write, { path: s.w.file, fromFile: own });

        const verdict = (yield* s.rig.holdings.judged(CHECKOUT, ['src/a.ts'])).get('src/a.ts')?.holding.verdict;
        expect(
          verdict?.verdict === 'proven'
            ? { hands: verdict.hands.map((hand) => [holderKey(hand.holder), hand.added, hand.removed]), nobody: verdict.nobody }
            : verdict,
        ).toEqual({ hands: [[MINE, 2, 2]], nobody: [] });
      }),
    ),
  );

  it.effect('when the overwriter’s line is committed, the overwritten row leaves with a witness of its lines', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        yield* s.w.wrote(MINE, lines([3, 'const four = 40;']));
        yield* s.w.wrote(THEIRS, lines([3, 'const four = 400;']));
        yield* s.pass();
        const landed = yield* s.commit('the overwriter lands', 'src/a.ts');

        yield* s.pass();

        expect(yield* s.rowsOf(THEIRS)).toEqual([{ state: 'committed', commit: landed, reason: null }]);
        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'withdrawn', commit: null, reason: 'overwritten' }]);
        const witnesses = yield* releasedAt(s.w.units, s.w.store, TEST_CHECKOUT, ['src/a.ts']);
        expect(witnesses.get('src/a.ts')?.map((one) => [one.thread, one.reason])).toEqual([[MINE, 'overwritten']]);

        writeFileSync(join(s.w.root, 'src', 'a.ts'), `${lines([3, 'const four = 4000;']).join('\n')}\n`);
        const moved = yield* s.commit('the path moves on', 'src/a.ts');
        yield* s.pass();
        expect(moved).not.toBe(landed);
        expect((yield* releasedAt(s.w.units, s.w.store, TEST_CHECKOUT, ['src/a.ts'])).get('src/a.ts')).toBeUndefined();
      }),
    ),
  );

  it.effect('a thread with an open command window keeps its rows through a move, and lets them go once the window closes', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        yield* s.w.wrote(MINE, lines([4, 'const five = 50;']));
        yield* s.pass();
        const journal = yield* journalOf(s.w.store, s.w.units, yield* CommandWalks);
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
        yield* s.w.run(['checkout', '--', 'src/a.ts']);
        yield* s.aside('while-running.txt');
        yield* s.pass();
        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'held', commit: null, reason: null }]);

        yield* journal.closed(['window']);
        yield* s.aside('after-running.txt');
        yield* s.pass();
        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'withdrawn', commit: null, reason: 'reverted' }]);
      }),
    ),
  );

  it.effect('a deleted thread’s rows leave as thread-deleted and keep a witness of what they left on disk', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        yield* s.w.wrote(MINE, lines([0, 'const one = 11;']));

        yield* s.rig.retirement.deleted(s.w.projectId, MINE);

        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'withdrawn', commit: null, reason: 'thread-deleted' }]);
        const witnesses = yield* releasedAt(s.w.units, s.w.store, TEST_CHECKOUT, ['src/a.ts']);
        expect(witnesses.get('src/a.ts')?.map((one) => [one.thread, one.reason])).toEqual([[MINE, 'thread-deleted']]);
      }),
    ),
  );

  it.effect('a whole-file landing with a missing before version keeps its commit link by the exact after digest', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        const head = yield* s.w.run(['rev-parse', 'HEAD']);
        const after = 'export const whole = 42;\n';
        writeFileSync(s.w.file, after);
        const at = new Date(yield* Clock.currentTimeMillis);
        yield* s.w.units.write(changeLogWrites, () =>
          insertRow(s.w.store.db, { projectId: s.w.projectId, holder: MINE }, null, head, 'held', {
            place: testPlace('src/a.ts'),
            projectId: s.w.projectId,
            origin: 'write',
            mode: '100644',
            hunk: null,
            beforeHash: contentDigest('unrecorded before\n'),
            afterHash: contentDigest(after),
            at,
          }),
        );
        writeFileSync(s.w.file, 'export const whole = 7;\n');
        yield* s.commit('a different whole file', 'src/a.ts');
        writeFileSync(s.w.file, after);
        const carrying = yield* s.commit('carry the whole file', 'src/a.ts');
        yield* s.pass();
        expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'committed', commit: carrying, reason: null }]);
      }),
    ),
  );

  it.effect('a move over a deleted file whose HEAD blob cannot be read neither stamps nor withdraws its row', () =>
    withRetirement((s) =>
      Effect.gen(function* () {
        const blob = yield* s.w.run(['rev-parse', 'HEAD:src/a.ts']);
        unlinkSync(join(s.w.root, 'src', 'a.ts'));
        yield* recordWrite(s.w.units, s.w.store, s.w.projectId, MINE, testPlace('src/a.ts'), {
          before: `${FILE.join('\n')}\n`,
          after: null,
          mode: '100644',
        });
        yield* s.pass();
        const object = join(s.w.root, '.git', 'objects', blob.slice(0, 2), blob.slice(2));
        yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            const kept = readFileSync(object);
            rmSync(object, { force: true });
            return kept;
          }),
          () =>
            Effect.gen(function* () {
              yield* s.aside('unrelated.txt');
              yield* s.pass();
              expect(yield* s.rowsOf(MINE)).toEqual([{ state: 'held', commit: null, reason: null }]);
            }),
          (kept) => Effect.sync(() => writeFileSync(object, kept)),
        );
      }),
    ),
  );
});
