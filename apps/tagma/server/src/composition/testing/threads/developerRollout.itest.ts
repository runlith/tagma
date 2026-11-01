import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Effect, FileSystem, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { fixtureMigrations } from '../migrations.js';
import { project } from '../../../projects/testing/doubles.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { threadRecord } from '../../../thread-record/testing/doubles.js';
import {
  thread,
  appendRolloutItem,
  exportThreadRollout,
  replayThreadRollout,
  rolloutForms,
  threadRolloutMeta,
} from '../../../threads/testing/doubles.js';
import { ENTRY_KINDS } from '../composed.js';

const CAPABILITIES = [
  'agents',
  'files',
  'shell',
  'web',
  'mcp',
  'plugins',
  'skills',
  'threads',
  'peers',
  'resources',
  'sandbox',
  'worktrees',
  'terminals',
  'artifacts',
  'reflections',
];

const FORMED = CAPABILITIES.map((capability) => (capability === 'plugins' ? 'apps' : capability));

const machine = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
  Layer.provideMerge(BunFileSystem.layer),
  Layer.provideMerge(Layer.succeed(ThreadEntryKinds, ENTRY_KINDS)),
);

layer(machine)('retired agent rollout recovery', (it) => {
  it.effect('a detached developer or code rollout restores onto tagma and preserves a derived profile’s capabilities', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'developer-rollout-' });
      const { db } = yield* MachineStore;
      const records = yield* makeThreadRecords;
      const forms = yield* rolloutForms((_id, work) => work, ENTRY_KINDS);
      const at = new Date('2026-10-01T10:00:00.000Z');
      const scope = yield* db.insert(project()).values({ name: 'p', repoKey: root, rootPath: root, createdAt: at }).returning().get();
      for (const hosted of [false, true]) {
        const id = hosted ? 'hosted' : 'plain';
        const profile = hosted
          ? { id: 'scout', overlay: { id: 'scout', baseAgentId: 'code', description: 'd', capabilities: ['files'] } }
          : { id: 'developer', overlay: { id: 'developer', baseAgentId: 'developer', description: '', capabilities: CAPABILITIES } };
        yield* bornThread(
          db,
          {
            id,
            ownerId: 'owner',
            agentId: hosted ? 'harness' : 'developer',
            authority: { mode: 'trust', bypassFrom: null },
            profile,
            transport: hosted ? { adapter: 'acp', profile: 'claude', agent: 'code' } : { adapter: 'native', profile: null, agent: null },
            spawnRootId: id,
            cacheGroup: id,
            provider: 'openai-oauth',
            status: 'idle',
            createdAt: at,
            updatedAt: at,
          },
          { projectId: scope!.id, title: id },
        );
        const path = join(root, `${id}.jsonl`);
        yield* exportThreadRollout({ threadId: id, path, parts: yield* nativeOnlyParts });
        if (hosted) yield* appendRolloutItem(path, { kind: 'meta', meta: yield* threadRolloutMeta(id, yield* nativeOnlyParts) });
        yield* db.delete(threadRecord()).where(eq(threadRecord().id, id));
        yield* forms.formedHere(id, path);
        yield* replayThreadRollout({ path, parts: yield* nativeOnlyParts, records });
        expect((yield* records.facts(id))?.agentId).toBe(hosted ? 'harness' : 'tagma');
        const native = yield* db.select().from(thread()).where(eq(thread().id, id)).get();
        expect(native?.transport).toEqual(
          hosted ? { adapter: 'acp', profile: 'claude-code', agent: 'tagma' } : { adapter: 'native', profile: null, agent: null },
        );
        expect(native?.profile).toMatchObject({
          id: hosted ? 'scout' : 'tagma',
          overlay: { id: hosted ? 'scout' : 'tagma', baseAgentId: 'tagma', capabilities: hosted ? ['files'] : FORMED },
        });
        const [header, ...tail] = (yield* files.readFileString(path))
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        const meta = [header, ...tail.filter((line) => line.kind === 'meta').map((line) => line.meta)];
        const current = [hosted ? 'harness' : 'tagma', 'tagma'];
        expect(meta.map((line) => [line.record.agentId, line.native.profile.overlay.baseAgentId])).toEqual(
          hosted ? [current, current] : [current],
        );
      }
    }),
  );
});
