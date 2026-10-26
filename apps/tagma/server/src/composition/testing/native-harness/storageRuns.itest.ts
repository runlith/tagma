import { layer } from '@runlith/effect-test';
import { describeThreadStorageRuns } from '@runlith/agent/thread/conformance/storagePort';
import { fileThreadStorage, openFileThreadStorage } from '../fileStorage.js';

layer(fileThreadStorage, { excludeTestServices: true })('SQLite run storage contracts', (it) => {
  describeThreadStorageRuns('Tagma bun:sqlite', openFileThreadStorage, it.effect);
});
