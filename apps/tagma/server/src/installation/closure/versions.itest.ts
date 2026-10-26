import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPLICATION_PLACE } from '../contract/wire/layout.js';
import { swapCurrent } from './versions.js';
import { holdVersion, pruneVersions } from './leases.js';

const owned = mkdtempSync('/tmp/tagma-versions-');
afterAll(() => rmSync(owned, { recursive: true, force: true }));

test('a build prunes old versions but keeps the one a live process still runs from and the records beside them', () => {
  for (const version of ['v1', 'v2', 'v3']) mkdirSync(join(owned, version));
  writeFileSync(join(owned, APPLICATION_PLACE), '/Applications/Tagma.app\n');
  swapCurrent(owned, 'v3');
  holdVersion(join(owned, 'v1'));

  pruneVersions(owned, ['v3']);

  expect(readdirSync(owned).sort()).toEqual([APPLICATION_PLACE, 'current', 'v1', 'v3']);
});
