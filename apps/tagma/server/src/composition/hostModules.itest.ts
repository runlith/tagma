import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { marksOf, workspaceManifests } from '@runlith/tagma/adapter/host-modules';
import { GENERATED, generatedText } from './hostModules.js';

test('the host module list is the one the owners mark for adapters, split into the shared and the developer surface', async () => {
  const marks = marksOf(await workspaceManifests(join(import.meta.dir, '../../../../..')));

  expect(await readFile(join(import.meta.dir, GENERATED), 'utf8')).toBe(generatedText(marks));
  expect(marks.shared).toContain('effect');
  expect(marks.developer).toContain('@runlith/llm/route/executor');
  expect(marks.shared.filter((specifier) => marks.developer.includes(specifier))).toEqual([]);
});
