import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostSpecifiers, workspaceManifests } from '@runlith/tagma/adapter/host-modules';
import { GENERATED, generatedText } from './hostModules.js';

test('the host module list is the one the owners mark for adapters', async () => {
  const specifiers = hostSpecifiers(await workspaceManifests(join(import.meta.dir, '../../../../..')));

  expect(await readFile(join(import.meta.dir, GENERATED), 'utf8')).toBe(generatedText(specifiers));
  expect(specifiers).toContain('effect');
  expect(specifiers).toContain('@runlith/llm/route/executor');
});
