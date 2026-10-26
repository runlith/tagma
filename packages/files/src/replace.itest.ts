import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect } from 'effect';
import { applyLineEdits } from './lines';
import { entryAt, fileFailure, removeEntry, replaced, type Standing } from './replace';

const dir = mkdtempSync(join(tmpdir(), 'replace-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const standing = (text: string): Standing => ({ bytes: new TextEncoder().encode(text) });

layer(BunFileSystem.layer, { excludeTestServices: true })('file replacement', (it) => {
  it.effect('removing a selected directory never recursively removes a newly present child', () =>
    Effect.gen(function* () {
      const path = join(dir, 'selected-directory');
      mkdirSync(path);
      const selected = yield* entryAt(path);
      if (selected === undefined) return yield* Effect.die('The directory is missing.');
      writeFileSync(join(path, 'new-child'), 'kept');
      const failure = yield* Effect.flip(removeEntry(path, selected));
      expect(fileFailure(failure)).toContain('ENOTEMPTY');
      expect(readFileSync(join(path, 'new-child'), 'utf8')).toBe('kept');
      unlinkSync(join(path, 'new-child'));
      expect(yield* removeEntry(path, selected)).toBe(true);
      expect(yield* entryAt(path)).toBeUndefined();
    }),
  );

  it.effect('a link to a directory is removed as an entry without reading or changing its target', () =>
    Effect.gen(function* () {
      const target = join(dir, 'entry-link-target');
      const path = join(dir, 'entry-link');
      mkdirSync(target);
      writeFileSync(join(target, 'file'), 'kept');
      symlinkSync(target, path);
      const selected = yield* entryAt(path);
      if (selected === undefined) return yield* Effect.die('The link is missing.');
      expect(selected.kind).toBe('link');
      expect(yield* removeEntry(path, selected)).toBe(true);
      expect(readFileSync(join(target, 'file'), 'utf8')).toBe('kept');
    }),
  );

  it.effect('a line edit over a CRLF file with a BOM and no final ending keeps every untouched byte, mode included', () =>
    Effect.gen(function* () {
      const path = join(dir, 'crlf.txt');
      const base = '\uFEFFone\r\ntwo\r\nthree';
      writeFileSync(path, base);
      chmodSync(path, 0o755);
      const edited = yield* Effect.fromResult(applyLineEdits(base, [{ from: 1, to: 2, lines: ['TWO'] }]));
      expect(yield* replaced(path, standing(base), edited)).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe('\uFEFFone\r\nTWO\r\nthree');
      expect(lstatSync(path).mode & 0o777).toBe(0o755);
    }),
  );

  it.effect('a write whose standing bytes moved is refused and leaves the file as it is', () =>
    Effect.gen(function* () {
      const path = join(dir, 'moved.txt');
      writeFileSync(path, 'now');
      expect(yield* replaced(path, standing('then'), 'edit')).toBe(false);
      expect(readFileSync(path, 'utf8')).toBe('now');
    }),
  );

  it.effect('a file is born only where nothing stands, with the mode asked for', () =>
    Effect.gen(function* () {
      const path = join(dir, 'born.sh');
      expect(yield* replaced(path, { absent: true }, 'echo\n', { executable: true })).toBe(true);
      expect(lstatSync(path).mode & 0o777).toBe(0o755);
      expect(yield* replaced(path, { absent: true }, 'again\n')).toBe(false);
      expect(readFileSync(path, 'utf8')).toBe('echo\n');
    }),
  );

  it.effect('a write through a symlink changes its target and keeps the link', () =>
    Effect.gen(function* () {
      const target = join(dir, 'target.txt');
      const link = join(dir, 'link.txt');
      writeFileSync(target, 'old');
      symlinkSync(target, link);
      expect(yield* replaced(link, standing('old'), 'new')).toBe(true);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readFileSync(target, 'utf8')).toBe('new');
    }),
  );

  it.effect('a removal needs the standing bytes and announces itself only when it goes ahead', () =>
    Effect.gen(function* () {
      const path = join(dir, 'gone.txt');
      writeFileSync(path, 'bytes');
      const announced: string[] = [];
      const publishing = () => {
        announced.push('published');
        return () => announced.push('withdrawn');
      };
      expect(yield* replaced(path, standing('other'), null, { publishing })).toBe(false);
      expect(announced).toEqual([]);
      expect(yield* replaced(path, standing('bytes'), null, { publishing })).toBe(true);
      expect(announced).toEqual(['published']);
    }),
  );

  it.effect('a file that vanished before the write is a miss of the check, not a failure', () =>
    Effect.gen(function* () {
      expect(yield* replaced(join(dir, 'never-was.txt'), standing('was'), 'edit')).toBe(false);
    }),
  );

  it.effect('a resource-bound replacement refuses a new symlink even when its target holds the same bytes', () =>
    Effect.gen(function* () {
      const path = join(dir, 'bound.txt');
      const other = join(dir, 'redirected.txt');
      writeFileSync(path, 'same');
      writeFileSync(other, 'same');
      const resource = realpathSync(path);
      unlinkSync(path);
      symlinkSync(other, path);
      expect(yield* replaced(path, standing('same'), 'edit', { resource })).toBe(false);
      expect(readFileSync(other, 'utf8')).toBe('same');
      expect(lstatSync(path).isSymbolicLink()).toBe(true);
    }),
  );
});
