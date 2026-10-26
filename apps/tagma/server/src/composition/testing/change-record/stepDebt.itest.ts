import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { holdingsOver } from '../../../change-record/testing/holdings.js';
import { debtsAt } from '../../../change-record/record/debts.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { TEST_CHECKOUT } from '../../../workspace/testing/doubles.js';
import { FILE, MINE, THEIRS, checkoutFixture, withCheckout } from '../checkoutFixture.js';
import { Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { LineWrites } from '../../../change-record/contract/service/lineWrites.js';
import { idleCommands } from '../../../change-record/testing/doubles.js';
import { lineWrites } from '../../lineWrites.js';
import { recordOver } from '../landingServices.js';
import type { DebtSource } from '../../../change-record/contract/wire/reshape.js';

const CHECKOUT = RootId.make(TEST_CHECKOUT);
const lines = (...changed: readonly [number, string][]): string[] => {
  const next = [...FILE];
  for (const [at, text] of changed) next[at] = text;
  return next;
};

layer(Layer.merge(checkoutFixture, BunFileSystem.layer), { excludeTestServices: true })('checkout', (it) => {
  it.effect('step and post-commit debt preserve peer bytes and repay only the form the current HEAD allows', () =>
    withCheckout((w) =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const record = yield* recordOver(w.store, w.units, yield* idleCommands());
        const rig = yield* holdingsOver(w.store, w.units, w.git, w.root, undefined, undefined, lineWrites);
        const tail = 'const four = 4; // mine';
        const text = (rows: readonly string[]) => `${rows.join('\n')}\n`;
        const split = [...FILE.slice(0, 2), 'const three =', '  3;', ...FILE.slice(3)];
        const before = text([...split.slice(0, 4), `${tail}  `, FILE[4] as string]);
        const after = text(lines([3, tail]));
        const live = text(lines([2, 'const three = 3; // theirs'], [3, `${tail}  `]));
        const safe = 'src/safe.ts';
        const safePath = join(w.root, safe);
        const mine = 'const five = 5; // mine';
        const safeBefore = text(lines([2, 'const three = 3;   '], [4, `${mine}  `]));
        const safeAfter = text(lines([4, mine]));
        const safeLive = text(lines([2, 'const three = 3; // theirs'], [4, `${mine}  `]));
        const safePeer = text(lines([2, 'const three = 3; // theirs'], [4, mine]));
        const post = 'src/post.ts';
        const postPath = join(w.root, post);
        const posted = text(lines([0, 'const one = 1; // posted']));
        const blob = Effect.fnUntraced(function* (value: string) {
          const result = yield* w.git.run(['hash-object', '-w', '--stdin', '--path=src/a.ts'], { cwd: w.root, stdin: value });
          if (result.status !== 0) return yield* Effect.die(new Error(result.stderr));
          return result.stdout.trim();
        });
        const owed = () => debtsAt(w.units, w.store, TEST_CHECKOUT, ['src/a.ts', safe]);
        const checkout = { projectId: w.projectId, root: w.root, origin: w.originFor(MINE), git: w.git };
        const reshape = Effect.fnUntraced(function* (path: string, older: string, newer: string, commit: string, source: DebtSource) {
          const inputs = yield* record.reshapeRead(checkout, [{ path, before: older, after: newer }]);
          return yield* record
            .reshape(checkout, inputs, { _tag: 'unheld' }, { commit, source })
            .pipe(Effect.provideService(LineWrites, lineWrites));
        });

        yield* files.writeFileString(w.file, text(split));
        yield* files.writeFileString(safePath, text(lines([2, 'const three = 3;   '])));
        yield* files.writeFileString(postPath, text(FILE));
        yield* w.run(['add', '-A']);
        yield* w.run(['commit', '-qm', 'unformed source']);
        yield* w.wrote(THEIRS, lines([2, 'const three = 3; // theirs']));
        yield* w.wrote(MINE, lines([2, 'const three = 3; // theirs'], [3, `${tail}  `]));
        yield* w.wrote(THEIRS, lines([0, 'const one = 100;']), { path: post });
        yield* w.wrote(THEIRS, lines([2, 'const three = 3; // theirs']), { path: safe });
        yield* w.wrote(MINE, lines([2, 'const three = 3; // theirs'], [4, `${mine}  `]), { path: safe });
        const safeOlder = yield* blob(safeBefore);
        const safeNewer = yield* blob(safeAfter);
        const older = yield* blob(before);
        const newer = yield* blob(after);
        const oldPost = yield* blob(text(FILE));
        const newPost = yield* blob(posted);
        yield* files.writeFileString(w.file, after);
        yield* files.writeFileString(safePath, safeAfter);
        yield* w.run(['add', '--', 'src/a.ts', safe]);
        yield* w.run(['commit', '-qm', 'the selected author lines in their step form']);
        const commit = yield* w.run(['rev-parse', 'HEAD']);
        yield* files.writeFileString(w.file, live);
        yield* files.writeFileString(safePath, safeLive);

        expect(yield* reshape('src/a.ts', older, newer, commit, 'steps')).toEqual([
          { _tag: 'kept', path: 'src/a.ts', why: 'conflict', owed: true },
        ]);
        expect(yield* reshape(safe, safeOlder, safeNewer, commit, 'steps')).toEqual([
          { _tag: 'kept', path: safe, why: 'conflict', owed: true },
        ]);
        expect(yield* reshape(post, oldPost, newPost, commit, 'post-commit')).toEqual([
          { _tag: 'kept', path: post, why: 'conflict', owed: true },
        ]);
        expect((yield* owed()).get('src/a.ts')?.map((debt) => debt.commit)).toEqual([commit]);
        expect(yield* rig.retirement.settle(CHECKOUT)).toBe(0);
        expect(yield* files.readFileString(w.file)).toBe(live);
        expect(yield* files.readFileString(postPath)).toBe(text(lines([0, 'const one = 100;'])));

        yield* w.wrote(THEIRS, FILE, { path: post });
        expect(yield* rig.retirement.settle(CHECKOUT)).toBe(1);
        expect(yield* files.readFileString(postPath)).toBe(posted);
        const peerForm = text(lines([2, 'const three = 3; // theirs'], [3, tail]));
        yield* files.writeFileString(w.file, peerForm);
        yield* files.writeFileString(safePath, safePeer);
        yield* w.run(['add', '--', 'src/a.ts', safe]);
        yield* w.run(['commit', '-qm', 'the peer replacement in its step form']);
        yield* files.writeFileString(w.file, live);
        yield* files.writeFileString(safePath, safeLive);
        yield* rig.holdings.moved(CHECKOUT, 'all');
        expect(yield* rig.retirement.settle(CHECKOUT)).toBe(1);
        expect(yield* files.readFileString(safePath)).toBe(safePeer);
        expect(yield* files.readFileString(w.file)).toBe(live);
        expect((yield* owed()).get('src/a.ts')?.map((debt) => debt.commit)).toEqual([commit]);

        yield* w.wrote(MINE, lines([2, 'const three = 3; // theirs'], [3, tail]));
        expect(yield* rig.retirement.settle(CHECKOUT)).toBe(1);
        expect(yield* files.readFileString(w.file)).toBe(peerForm);
        expect((yield* owed()).size).toBe(0);
        expect(yield* rig.retirement.settle(CHECKOUT)).toBe(0);
        expect(yield* w.run(['status', '--porcelain', '--', 'src/a.ts'])).toBe('');
      }),
    ),
  );
});
