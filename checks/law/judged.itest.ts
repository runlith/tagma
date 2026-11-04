import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judgedFile } from './judged';

test('a tracked binary is read from the judged commit while the checkout holds a neighbour’s other bytes', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'judged-file-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    mkdirSync(join(root, 'native'));
    const judged = new Uint8Array([0x50, 0x4b, 0xff, 0x00, 0xfe]);
    const asset = join(root, 'native/archive.zip');
    writeFileSync(asset, judged);
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'seed');
    const commit = git('rev-parse', 'HEAD');
    expect(judgedFile(root, commit, asset)).toBe(asset);

    writeFileSync(asset, new Uint8Array([0x50, 0x4b, 0x01, 0x02]));
    const taken = judgedFile(root, commit, asset);
    expect(taken).not.toBe(asset);
    expect(new Uint8Array(readFileSync(taken))).toEqual(judged);
    expect(judgedFile(root, commit, asset)).toBe(taken);
    expect(new Uint8Array(readFileSync(asset))).toEqual(new Uint8Array([0x50, 0x4b, 0x01, 0x02]));

    const untracked = join(root, 'native/other.zip');
    writeFileSync(untracked, new Uint8Array([1]));
    expect(judgedFile(root, commit, untracked)).toBe(untracked);
    expect(judgedFile(root, commit, join(tmpdir(), 'outside.zip'))).toBe(join(tmpdir(), 'outside.zip'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
