import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncGenerated } from './generated.js';

const before = process.env.XDG_CACHE_HOME;
let home = '';
let checked: readonly string[] = [];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'tagma-kit-'));
  process.env.XDG_CACHE_HOME = home;
  checked = (await syncGenerated({ write: false })).changed;
});

afterAll(async () => {
  if (before === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = before;
  await rm(home, { recursive: true, force: true });
});

const record = async (): Promise<{ readonly path: string; readonly text: string }> => {
  const directory = join(home, 'tagma-kit');
  const [name] = await readdir(directory);
  const path = join(directory, name!);
  return { path, text: await readFile(path, 'utf8') };
};

test("the plugin SDK's generated types and schemas match the owners' point and operation schemas as they stand", () => {
  expect(checked).toEqual([]);
});

test('a generation that finds its files current records every file it read, and the next one answers from that record', async () => {
  expect(checked).toEqual([]);
  const { files } = JSON.parse((await record()).text) as { readonly files: readonly string[] };
  expect(files).toEqual(
    expect.arrayContaining([
      'bun.lock',
      'package.json',
      'packages/tagma/kit/generated.ts',
      'apps/tagma/server/src/views/contract/wire/graph.ts',
      'apps/tagma/app/src/lib/features/plugin-views/ui.ts',
      'apps/tagma/app/src/lib/features/plugin-views/PluginPaneTitle.svelte',
    ]),
  );
  expect(await syncGenerated({ write: true })).toEqual({ changed: [], recorded: true });
});

test('a record whose files no longer hash to its digest answers nothing, and the generation runs whole', async () => {
  expect(checked).toEqual([]);
  const { path, text } = await record();
  await writeFile(path, JSON.stringify({ ...(JSON.parse(text) as object), digest: '0'.repeat(64) }));
  expect(await syncGenerated({ write: true })).toEqual({ changed: [], recorded: false });
});
