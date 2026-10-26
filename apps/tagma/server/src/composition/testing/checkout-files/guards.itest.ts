import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { bytesDigest } from '@runlith/files/content';
import { standing, workspaceChange } from '../../../change-record/store/tables.js';
import { feeding } from '../../../checkout-files/testing/world.js';
import { layers } from '../change-record/threadFilesWorld.js';
import { bytes, filesWorld } from './world.js';

const appended = (base: string, path: string) => ({
  path,
  base: bytesDigest(bytes(base)),
  write: 'w',
  edits: [{ from: 1, to: 1, lines: ['more'] }],
  text: undefined,
});

layer(layers, { excludeTestServices: true })('checkout path guards', (it) => {
  it.effect(
    'a save through a link outside the checkout, into git’s own directory or by an absolute path is refused and writes nothing',
    () =>
      Effect.gen(function* () {
        const w = yield* filesWorld;
        const away = yield* w.files.makeTempDirectoryScoped({ prefix: 'outside-' });
        yield* w.files.writeFileString(join(away, 'secret.txt'), 'kept\n');
        yield* w.files.symlink(join(away, 'secret.txt'), w.at('out.txt'));

        const codes = yield* Effect.forEach(['out.txt', '.git/config', `${away}/secret.txt`], (path) =>
          Effect.map(Effect.flip(w.saves.save(w.place, appended('kept\n', path))), (refused) => refused.code),
        );
        expect(codes).toEqual(['path-outside-tree', 'path-outside-tree', 'path-outside-tree']);
        expect(yield* w.files.readFileString(join(away, 'secret.txt'))).toBe('kept\n');
      }),
  );

  it.effect('a save through a link inside the checkout writes the target and records the target’s lines', () =>
    Effect.gen(function* () {
      const w = yield* filesWorld;
      yield* w.write('real/target.txt', 'one\n');
      yield* w.files.symlink('real/target.txt', w.at('link.txt'));

      yield* w.saves.save(w.place, appended('one\n', 'link.txt'));

      expect(yield* w.files.readFileString(w.at('real/target.txt'))).toBe('one\nmore\n');
      const rows = yield* w.store.db
        .select({ path: workspaceChange.path })
        .from(workspaceChange)
        .where(and(eq(workspaceChange.checkout, w.rootId), standing));
      expect(rows.map((row) => row.path)).toEqual(['real/target.txt']);
    }),
  );

  it.effect('moves whose destinations land inside one another are refused before anything moves', () =>
    Effect.gen(function* () {
      const w = yield* filesWorld;
      yield* w.write('a.txt', 'a\n');
      yield* w.write('b.txt', 'b\n');

      const refused = yield* Effect.flip(
        w.entries.move(w.place, [
          { from: 'a.txt', to: 'new/x' },
          { from: 'b.txt', to: 'new/x/y' },
        ]),
      );
      expect(refused.code).toBe('target-exists');
      expect([yield* w.files.exists(w.at('a.txt')), yield* w.files.exists(w.at('b.txt')), yield* w.files.exists(w.at('new'))]).toEqual([
        true,
        true,
        false,
      ]);
    }),
  );

  it.effect('a document opened after its file was moved opens on the frame naming where it went', () =>
    Effect.gen(function* () {
      const w = yield* filesWorld;
      yield* w.write('old.txt', 'text\n');
      yield* w.entries.move(w.place, [{ from: 'old.txt', to: 'new.txt' }]);

      const frames = yield* feeding(w.documents.subscribe(w.place, 'old.txt'));
      expect(yield* frames.next).toEqual({ kind: 'moved', path: 'new.txt' });
    }),
  );
});
