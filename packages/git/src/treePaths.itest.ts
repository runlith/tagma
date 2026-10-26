import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { treeBlobAt } from './treePaths.js';
import { git, onGit, release, tempRepo } from './testing/fixture.js';

afterAll(release);

test('a tree blob answers its bytes and mode, a link its target, and an absent path, a gitlink or a directory answer nothing', async () => {
  const root = await tempRepo('git-tree-blob-');
  writeFileSync(join(root, 'kept.jsonc'), '\uFEFF{ "commit": [] }\n');
  symlinkSync('kept.jsonc', join(root, 'linked.jsonc'));
  mkdirSync(join(root, 'folder.jsonc'));
  writeFileSync(join(root, 'folder.jsonc', 'inner.txt'), 'inside\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'born']);
  const head = await git(root, ['rev-parse', 'HEAD']);
  await git(root, ['update-index', '--add', '--cacheinfo', `160000,${head},module.jsonc`]);
  await git(root, ['commit', '-qm', 'gitlink']);
  const tree = await git(root, ['rev-parse', 'HEAD^{tree}']);

  const read = (path: string) => onGit((service) => treeBlobAt(service, root, tree, path));
  const kept = await read('kept.jsonc');
  const linked = await read('linked.jsonc');

  expect(kept?.mode).toBe('100644');
  expect(kept === null ? null : new TextDecoder('utf-8', { ignoreBOM: true }).decode(kept.bytes)).toBe('\uFEFF{ "commit": [] }\n');
  expect(linked?.mode).toBe('120000');
  expect(linked === null ? null : new TextDecoder().decode(linked.bytes)).toBe('kept.jsonc');
  expect(await read('absent.jsonc')).toBeNull();
  expect(await read('module.jsonc')).toBeNull();
  expect(await read('folder.jsonc')).toBeNull();
}, 6_000);
