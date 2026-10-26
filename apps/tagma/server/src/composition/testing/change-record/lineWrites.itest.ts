import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, lstatSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect } from 'effect';
import { lineWrites } from '../../lineWrites';

const root = mkdtempSync(join(tmpdir(), 'lw-'));
const go = (input: Parameters<typeof lineWrites.replace>[0]) => lineWrites.replace(input, Effect.succeed(true));

layer(BunFileSystem.layer, { excludeTestServices: true })('line writes', (it) => {
  it.effect(
    'a line write checks the standing text, sets the mode, creates and removes, writes through a symlink inside the root and refuses one that leaves it',
    () =>
      Effect.gen(function* () {
        writeFileSync(join(root, 'a.txt'), 'old\r\n');
        chmodSync(join(root, 'a.txt'), 0o644);
        expect(yield* go({ root, path: 'a.txt', before: 'old\r\n', after: 'new\r\n', mode: '100755' })).toBe(true);
        expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('new\r\n');
        expect(lstatSync(join(root, 'a.txt')).mode & 0o777).toBe(0o755);
        expect(yield* go({ root, path: 'a.txt', before: 'stale', after: 'x' })).toBe(false);
        expect(yield* go({ root, path: 'sub/b.txt', before: null, after: 'born' })).toBe(true);
        expect(readFileSync(join(root, 'sub/b.txt'), 'utf8')).toBe('born');
        expect(yield* go({ root, path: 'sub/b.txt', before: 'born', after: null })).toBe(true);
        symlinkSync('/etc/hosts', join(root, 'out'));
        expect(yield* go({ root, path: 'out', before: 'x', after: 'y' })).toBe(false);
        symlinkSync(join(root, 'a.txt'), join(root, 'in'));
        expect(yield* go({ root, path: 'in', before: 'new\r\n', after: 'via' })).toBe(true);
        expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('via');
      }),
  );
});
