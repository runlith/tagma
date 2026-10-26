import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { and, eq, like } from 'drizzle-orm';
import { Effect } from 'effect';
import { bytesDigest } from '@runlith/files/content';
import { standing, workspaceChange } from '../../../change-record/store/tables.js';
import { feeding } from '../../../checkout-files/testing/world.js';
import { makeRevealInFiles } from '../../../checkout-files/reveal/files.js';
import { makeTargets } from '../../../checkout-files/tree/target.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { fixedCheckoutPaths } from '../../../workspace/testing/doubles.js';
import { PROJECT, layers } from '../change-record/threadFilesWorld.js';
import { bytes, filesWorld as world } from './world.js';

layer(layers, { excludeTestServices: true })('checkout files', (it) => {
  it.effect(
    'a save over bytes that moved is answered moved with the digest standing, and a save over the bytes it saw keeps their line endings',
    () =>
      Effect.gen(function* () {
        const w = yield* world;
        yield* w.write('doc.txt', 'a\r\n');
        const saved = yield* w.saves.save(w.place, {
          path: 'doc.txt',
          base: bytesDigest(bytes('a\r\n')),
          write: 'w1',
          edits: [{ from: 1, to: 1, lines: ['b'] }],
          text: undefined,
        });
        expect(saved).toEqual({ status: 'ok', digest: bytesDigest(bytes('a\r\nb\r\n')), kept: true, unconfirmed: null });

        const stale = yield* w.saves.save(w.place, {
          path: 'doc.txt',
          base: bytesDigest(bytes('a\r\n')),
          write: 'w2',
          edits: [{ from: 0, to: 1, lines: ['z'] }],
          text: undefined,
        });
        expect(stale).toEqual({ status: 'moved', digest: bytesDigest(bytes('a\r\nb\r\n')) });
        expect(yield* w.files.readFileString(w.at('doc.txt'))).toBe('a\r\nb\r\n');
      }),
  );

  it.effect('the document frame a save causes carries its id, and the file event of that same save adds no frame', () =>
    Effect.gen(function* () {
      const w = yield* world;
      yield* w.write('doc.txt', 'one\n');
      const frames = yield* feeding(w.documents.subscribe(w.place, 'doc.txt'));
      expect((yield* frames.next).kind).toBe('whole');

      yield* w.saves.save(w.place, {
        path: 'doc.txt',
        base: bytesDigest(bytes('one\n')),
        write: 'mine',
        edits: [{ from: 1, to: 1, lines: ['two'] }],
        text: undefined,
      });
      expect(yield* frames.next).toMatchObject({ kind: 'change', digest: bytesDigest(bytes('one\ntwo\n')), write: 'mine' });

      yield* w.write('doc.txt', 'one\ntwo\nthree\n');
      const next = yield* frames.next;
      expect(next).toMatchObject({ kind: 'change', digest: bytesDigest(bytes('one\ntwo\nthree\n')) });
      expect(next.kind === 'change' && next.write).toBeUndefined();
    }),
  );

  it.effect('a directory spanning digest batches moves each recorded file under its old path and leaves ignored files unrecorded', () =>
    Effect.gen(function* () {
      const w = yield* world;
      const count = 201;
      yield* w.write('.gitignore', '*.log\n');
      yield* Effect.forEach(
        Array.from({ length: count }, (_, n) => n),
        (n) => w.write(`big/f${n}.txt`, `${n}\n`),
        { concurrency: 16, discard: true },
      );
      yield* w.write('big/noise.log', 'noise\n');
      yield* w.entries.move(w.place, [{ from: 'big', to: 'moved/big' }]);

      const rows = yield* w.store.db
        .select({ path: workspaceChange.path, movedFrom: workspaceChange.movedFrom })
        .from(workspaceChange)
        .where(and(eq(workspaceChange.checkout, w.rootId), like(workspaceChange.path, 'moved/big/%'), standing));
      expect(rows).toHaveLength(count);
      expect(rows.every((row) => row.movedFrom === row.path.replace('moved/', ''))).toBe(true);
      const ignored = yield* w.store.db
        .select({ id: workspaceChange.id })
        .from(workspaceChange)
        .where(like(workspaceChange.path, '%noise.log'));
      expect(ignored).toEqual([]);
      expect(yield* w.files.readFileString(w.at('moved/big/noise.log'))).toBe('noise\n');

      const sample = ['moved/big/f0.txt', 'moved/big/f200.txt'];
      const judged = yield* w.holdings.judged(w.rootId, sample);
      expect(sample.map((path) => judged.get(path)?.holding.from)).toEqual(['big/f0.txt', 'big/f200.txt']);
    }),
  );

  it.effect('a deleted directory restored from the trash returns its bytes to the paths it left', () =>
    Effect.gen(function* () {
      const w = yield* world;
      yield* w.write('gone/a.txt', 'alpha\n');
      yield* w.files.writeFile(w.at('gone/b.bin'), new Uint8Array([0, 1, 2]));

      const { trash } = yield* w.entries.trash(w.place, ['gone']);
      expect(yield* w.files.exists(w.at('gone'))).toBe(false);

      const { paths } = yield* w.entries.restore(w.place, trash);
      expect(paths).toEqual(['gone']);
      expect(yield* w.files.readFileString(w.at('gone/a.txt'))).toBe('alpha\n');
      expect([...(yield* w.files.readFile(w.at('gone/b.bin')))]).toEqual([0, 1, 2]);
    }),
  );

  it.effect(
    'revealing an entry hands the file manager its absolute path, and refuses a path outside the checkout or one that does not exist before any program runs',
    () =>
      Effect.gen(function* () {
        const w = yield* world;
        yield* w.write('src/a.ts', 'a\n');
        const launched: (readonly string[])[] = [];
        const reveal = makeRevealInFiles({
          targets: yield* makeTargets({ graph: '.tagma' }).pipe(
            Effect.provideService(CheckoutPaths, yield* fixedCheckoutPaths(PROJECT, [{ checkout: w.rootId, root: w.root }])),
          ),
          launch: (program, args) => Effect.sync(() => (launched.push([program, ...args]), 0)),
          platform: 'darwin',
        });

        yield* reveal.show(w.place, 'src/a.ts');
        expect(launched).toEqual([['open', '-R', w.at('src/a.ts')]]);

        const outside = yield* Effect.flip(reveal.show(w.place, '../elsewhere'));
        const missing = yield* Effect.flip(reveal.show(w.place, 'src/none.ts'));
        expect([outside.code, missing.code]).toEqual(['path-outside-tree', 'files']);
        expect(launched).toHaveLength(1);

        yield* reveal.showLoose(w.at('src/a.ts'));
        const relative = yield* Effect.flip(reveal.showLoose('src/a.ts'));
        const absent = yield* Effect.flip(reveal.showLoose(w.at('src/none.ts')));
        expect(launched).toEqual([
          ['open', '-R', w.at('src/a.ts')],
          ['open', '-R', w.at('src/a.ts')],
        ]);
        expect([relative.code, absent.code]).toEqual(['path-outside-tree', 'files']);
      }),
  );
});
