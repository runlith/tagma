import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, expect, test } from 'bun:test';
import { developerMarks } from './hostModules';

const tree = realpathSync(mkdtempSync(join(tmpdir(), 'developer-marks-')));
afterAll(() => rmSync(tree, { recursive: true, force: true }));

const wrote = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
};

const DEVELOPER = { tagma: { build: 'developer' } };

wrote(join(tree, 'server/package.json'), { name: 'server' });
wrote(join(tree, 'server/src/core/file.ts'), '');
wrote(join(tree, 'server/src/marked/module.json'), DEVELOPER);
wrote(join(tree, 'server/src/marked/file.ts'), '');
wrote(join(tree, 'server/src/marked/inner/module.json'), { tagma: { host: {} } });
wrote(join(tree, 'server/src/marked/inner/file.ts'), '');
wrote(join(tree, 'both/module.json'), DEVELOPER);
wrote(join(tree, 'both/package.json'), DEVELOPER);
wrote(join(tree, 'both/file.ts'), '');
wrote(join(tree, 'adapter/package.json'), { name: 'adapter', ...DEVELOPER });
wrote(join(tree, 'adapter/src/entry.ts'), '');

test('the nearest manifest that marks a developer build decides, module.json before package.json', async () => {
  const marked = developerMarks();
  expect(await marked(join(tree, 'server/src/marked/file.ts'))).toEqual({ manifest: join(tree, 'server/src/marked/module.json') });
  expect(await marked(join(tree, 'both/file.ts'))).toEqual({ manifest: join(tree, 'both/module.json') });
  expect(await marked(join(tree, 'adapter/src/entry.ts'))).toEqual({ manifest: join(tree, 'adapter/package.json') });
});

test('a manifest without the mark does not stop the walk to a mark above it', async () => {
  expect(await developerMarks()(join(tree, 'server/src/marked/inner/file.ts'))).toEqual({
    manifest: join(tree, 'server/src/marked/module.json'),
  });
});

test('a file outside every marked tree is unmarked', async () => {
  expect(await developerMarks()(join(tree, 'server/src/core/file.ts'))).toBeNull();
});
