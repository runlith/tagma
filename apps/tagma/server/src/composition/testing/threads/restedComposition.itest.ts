import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Context, Effect, Schema } from 'effect';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { birthsOf, exportThreadRollout, rolloutsOf, threadEvent, threadRun } from '../../../threads/testing/doubles.js';
import { compositionEntryId } from '@runlith/agent/transcript/entryNames';
import { threadCompactionCheckpoint, threadPrunedToolCall } from '../../../native-harness/testing/doubles.js';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';
import { restOf } from '../../../threads/testing/rest.js';
import { ENTRY_KINDS } from '../../manifest.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import type { ThreadCompositionEntry } from '@runlith/agent/transcript/entries';
import { compactionChoicesSchema } from '../../../native-harness/contract/wire/compactionChoices.js';
import { Settings } from '../../../settings/contract/service/values.js';

const ledgerRead = Schema.decodeUnknownEffect(
  Schema.Struct({
    ledger: Schema.Struct({ compactions: Schema.Number }),
    cleared: Schema.Struct({ count: Schema.Number, tokens: Schema.Number }),
    parts: Schema.Array(Schema.Struct({ id: Schema.String, tokens: Schema.Number })),
  }),
);

const fixture = doorFixture();

it.live(
  'reading compaction choices preserves a rested journal and its compaction ledger',
  () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const projectId = yield* world.stealthProject();
      yield* projectLeaving(world, projectId);
      const id = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null })).thread.id;
      const rollouts = rolloutsOf(world.runtime.owners);
      yield* rollouts.ensure(id);
      const store = Context.get(world.runtime.graph, MachineStore);
      const { db } = store;
      const now = new Date(yield* Clock.currentTimeMillis);
      yield* Context.get(world.runtime.graph, Settings).write({
        scope: 'project',
        projectId,
        key: 'agent.compactionSummarizers',
        value: [{ provider: 'muse', model: 'muse-spark-1.3' }],
      });
      yield* db.insert(threadRun()).values({ id: 'run', threadId: id, ownerId: 'operator', status: 'completed', finishedAt: now });
      const composition: ThreadCompositionEntry = {
        type: 'composition',
        id: compositionEntryId('run'),
        runId: 'run',
        occurredAt: now.toISOString(),
        system: { chars: 400 },
        context: null,
        tools: { count: 1, chars: 48, each: [{ name: 'read', chars: 48 }] },
      };
      yield* db.insert(threadEvent()).values({
        threadId: id,
        position: 1,
        id: 'message',
        kind: 'message',
        payload: { entry: { type: 'message', id: 'message', role: 'user', text: 'Keep the context readable.' } },
      });
      yield* db
        .insert(threadEvent())
        .values({ threadId: id, position: 2, id: 'composition', kind: 'composition', payload: { entry: composition } });
      yield* db.insert(threadCompactionCheckpoint()).values([
        { id: 'checkpoint-a', threadId: id, coveredMessageCount: 1, coveredPrefixHash: 'prefix-a', summary: 'Old.', createdAt: now },
        {
          id: 'checkpoint-z',
          threadId: id,
          coveredMessageCount: 1,
          coveredPrefixHash: 'prefix-z',
          summary: 'A previous context summary.',
          createdAt: now,
        },
      ]);
      yield* db.insert(threadPrunedToolCall()).values({ threadId: id, toolCallId: 'retained', tokens: 17 });
      const path = join(world.dataHome, 'threads', String(projectId), `${id}.jsonl`);
      yield* exportThreadRollout({ threadId: id, path, parts: nativeOnlyParts }).pipe(
        Effect.provideService(MachineStore, store),
        Effect.provideService(ThreadEntryKinds, ENTRY_KINDS),
      );
      const before = yield* world.op('read_thread_composition', { threadId: id }, `project=${projectId}`);
      expect(before.status).toBe(200);
      const ledger = yield* ledgerRead(before.body);
      expect(ledger).toMatchObject({ ledger: { compactions: 2 }, cleared: { count: 1, tokens: 17 } });
      expect(ledger.parts.find((part) => part.id === 'system')?.tokens).toBeGreaterThan(0);
      const beforeMenu = yield* Schema.decodeUnknownEffect(compactionChoicesSchema)(
        (yield* world.op('read_compaction_choices', { threadId: id, limit: 1 }, `project=${projectId}`)).body,
      );
      expect(beforeMenu.chain[0]?.estimate).toEqual(expect.objectContaining({ inputTokens: expect.any(Number) }));
      expect((yield* rollouts.evict(projectId, id)).outcome).toBe('evicted');
      const stamp = yield* restOf(db, id);
      const menu = yield* world.op('read_compaction_choices', { threadId: id, limit: 1 }, `project=${projectId}`);
      expect(menu.status).toBe(200);
      const afterMenu = yield* Schema.decodeUnknownEffect(compactionChoicesSchema)(menu.body);
      expect(afterMenu.chain.map((choice) => choice.estimate)).toEqual(beforeMenu.chain.map((choice) => choice.estimate));
      const after = yield* world.op('read_thread_composition', { threadId: id }, `project=${projectId}`);
      expect(after.status).toBe(200);
      expect(yield* ledgerRead(after.body)).toEqual(ledger);
      expect(yield* restOf(db, id)).toEqual(stamp);
      expect(yield* db.select({ id: threadEvent().id }).from(threadEvent()).where(eq(threadEvent().threadId, id))).toEqual([]);
    }).pipe(Effect.provide(fixture)),
  60_000,
);
