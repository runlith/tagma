import { expect, test } from 'bun:test';
import type { Manifest } from '../platform/contract/service/manifest.js';
import { PARTS } from './developer/parts.js';
import { assemble } from './manifest.js';

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
