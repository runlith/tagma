import { expect, test } from 'bun:test';
import { hostBinary, hostBundle, RELEASE_INSIDE } from './bundle.js';

test('the bundle layout issued windows and servers read keeps its values', () => {
  expect([hostBundle('Tagma'), hostBinary('Tagma Dev'), RELEASE_INSIDE]).toEqual([
    'Tagma.app',
    'Tagma Dev.app/Contents/MacOS/Electron',
    'Contents/Resources/release',
  ]);
});
