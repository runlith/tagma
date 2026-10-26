import { layer } from '@runlith/effect-test';
import { describeThreadInboxPort } from '@runlith/agent/thread/conformance/inbox';
import { describeThreadResourceLedgerPort } from '@runlith/agent/thread/conformance/resources';
import { describeThreadRunStop } from '@runlith/agent/thread/conformance/runStop';
import { describeThreadSpawnBirth } from '@runlith/agent/thread/conformance/spawnBirth';
import { fileThreadStorage, openFileThreadStorage } from '../fileStorage.js';

layer(fileThreadStorage, { excludeTestServices: true })('SQLite relations', (it) => {
  describeThreadInboxPort('Tagma bun:sqlite', openFileThreadStorage, it.effect);
  describeThreadResourceLedgerPort('Tagma bun:sqlite', openFileThreadStorage, it.effect);
  describeThreadSpawnBirth('Tagma bun:sqlite', openFileThreadStorage, it.effect);
  describeThreadRunStop('Tagma bun:sqlite', openFileThreadStorage, it.effect);
});
