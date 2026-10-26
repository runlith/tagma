import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { workspaceChange } from '../../../change-record/store/tables.js';
import { bytesDigest } from '@runlith/files/content';
import { feeding } from '../../../checkout-files/testing/world.js';
import { PROJECT, layers } from '../change-record/threadFilesWorld.js';
import { bytes, filesWorld as world } from './world.js';

const outside = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  return yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'loose-' }));
});

layer(layers, { excludeTestServices: true })('loose documents', (it) => {
  it.effect(
    'a file outside the checkouts opens, saves with its own echo, follows the disk and answers moved over stale bytes; a checkout file is refused, its git directory is not',
    () =>
      Effect.gen(function* () {
        const w = yield* world;
        const dir = yield* outside;
        const abs = join(dir, 'notes.md');
        yield* w.files.writeFileString(abs, 'one\r\n');
        const file = yield* w.targets.loose(PROJECT, abs);
        const frames = yield* feeding(w.documents.subscribeLoose(file));
        expect(yield* frames.next).toMatchObject({ kind: 'whole', text: 'one\n', digest: bytesDigest(bytes('one\r\n')) });

        const save = (base: string, write: string, line: string) =>
          w.saves.saveLoose(file, { path: abs, base, write, edits: [{ from: 1, to: 1, lines: [line] }], text: undefined });
        expect(yield* save(bytesDigest(bytes('one\r\n')), 'mine', 'two')).toMatchObject({
          status: 'ok',
          digest: bytesDigest(bytes('one\r\ntwo\r\n')),
        });
        expect(yield* frames.next).toMatchObject({ kind: 'change', write: 'mine', digest: bytesDigest(bytes('one\r\ntwo\r\n')) });
        expect(yield* w.store.db.select({ id: workspaceChange.id }).from(workspaceChange)).toEqual([]);

        yield* w.files.writeFileString(abs, 'one\r\ntwo\r\nthree\r\n');
        const followed = yield* frames.until((frame) => frame.kind !== 'change' || frame.write === undefined);
        expect(followed).toMatchObject({ kind: 'change', digest: bytesDigest(bytes('one\r\ntwo\r\nthree\r\n')) });
        expect(yield* save(bytesDigest(bytes('one\r\n')), 'late', 'x')).toEqual({
          status: 'moved',
          digest: bytesDigest(bytes('one\r\ntwo\r\nthree\r\n')),
        });
        expect(yield* w.files.readFileString(abs)).toBe('one\r\ntwo\r\nthree\r\n');

        yield* w.write('src/a.ts', 'a\n');
        const refused = yield* Effect.flip(w.targets.loose(PROJECT, w.at('src/a.ts')));
        expect(refused.code).toBe('in-checkout');
        expect((yield* w.targets.loose(PROJECT, w.at('.git/config'))).abs).toBe(join(yield* w.files.realPath(w.at('.git')), 'config'));
      }),
  );
});
