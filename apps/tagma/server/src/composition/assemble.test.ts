import { expect, test } from 'bun:test';
import type { Manifest } from '../platform/contract/service/manifest.js';
import { PARTS } from './developer/parts.js';
import { assemble } from './manifest.js';

test('the view bridge methods are those of the composed modules, and a root without a module does not carry its method', async () => {
  const modules: readonly Manifest[] = PARTS.modules;
  const ids = async (composed: readonly Manifest[]) => (await assemble({ ...PARTS, modules: composed })).bridgeMethods.map(({ id }) => id);
  expect(await ids(modules)).toEqual(expect.arrayContaining(['open', 'storage/get', 'thread', 'speech']));
  expect(await ids(modules.filter((module) => module.id !== 'speech'))).not.toContain('speech');
});

test('a module another root adds is refused when it declares a setting a core module already declares', async () => {
  const modules: readonly Manifest[] = PARTS.modules;
  const taken = modules.flatMap((module) => module.settings ?? [])[0]!;
  const twin: Manifest = { id: 'twin', settings: [taken] };
  await expect(assemble({ ...PARTS, modules: [...modules, twin] })).rejects.toMatchObject({
    _tag: 'ManifestConflict',
    collection: 'settings',
    id: taken.id,
  });
});
