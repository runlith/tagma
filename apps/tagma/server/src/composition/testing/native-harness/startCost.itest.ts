import { expect } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { Clock, Context, Effect, Layer, Queue, Schema, Stream } from 'effect';
import { Settings } from '../../../settings/contract/service/values.js';
import { autoTitle } from '../../../threads/contract/wire/settings.js';
import { agentPreviewSchema } from '../../../threads/contract/wire/agentLibrary.js';
import { EvidenceFeed, ThreadEvidence } from '../../../threads/contract/service/evidence.js';
import { startShare } from '../../../native-harness/contract/wire/settings.js';
import { START_ENTRY, type StartEntry } from '../../../native-harness/contract/wire/start.js';
import { birthsOf, turnsOf } from '../../../threads/testing/doubles.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { modelDefaults } from '../claudeLogin.js';
import { settledThread } from './settled.fixture.js';

const usage = new Usage({ inputTokens: 10, outputTokens: 2, totalTokens: 12 });
const READY: readonly LLMEvent[] = [
  { type: 'text-start', id: 'text' },
  { type: 'text-delta', id: 'text', text: 'Ready.' },
  { type: 'text-end', id: 'text' },
  { type: 'step-finish', index: 0, reason: 'stop', usage },
  { type: 'finish', reason: 'stop', usage },
];

const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  yield* world.lend({
    models: (standing) => ({
      ...standing,
      request: (input) => ({ ...standing.request(input), stream: () => Stream.fromIterable(READY) }),
    }),
  });
  const now = yield* Clock.currentTimeMillis;
  yield* Effect.acquireRelease(
    world.runtime.tokens.add('subscription', {
      accessToken: 'bearer',
      refreshToken: 'refresh',
      expiresAt: now + 3_600_000,
      scope: 'user:inference',
      account: { uuid: 'start-account', email: 'start@example.com' },
      organization: { uuid: 'start-org', name: 'Start' },
    }),
    (key) => world.runtime.signIns.remove('subscription', key).pipe(Effect.orDie),
  );
  const root = yield* world.directory('project');
  yield* Effect.promise(() => writeFile(join(root, 'gate.ts'), 'export const gate = 1;\n'));
  const projectId = yield* world.stealthProject(root);
  const settings = Context.get(world.runtime.graph, Settings);
  yield* settings.write({ key: autoTitle.id, value: false, scope: 'project', projectId });
  yield* settings.write({ key: startShare.id, value: 0.01, scope: 'project', projectId });
  yield* modelDefaults(world, { provider: 'subscription', model: 'claude-sonnet-5-5', reasoning: 'low', account: null });
  return { world, projectId };
});

class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/StartCostWorld') {}

const cardsOf = Effect.fnUntraced(function* (threadId: string, projectId: number) {
  const snapshot = yield* (yield* ThreadEvidence).snapshot(threadId, projectId);
  return snapshot.transcript.filter((entry): entry is StartEntry => entry.type === START_ENTRY);
});

const carded = Effect.fnUntraced(
  function* (threadId: string, projectId: number) {
    const changed = yield* Effect.acquireRelease(Queue.unbounded<void>(), Queue.shutdown);
    const feed = yield* EvidenceFeed;
    yield* Effect.acquireRelease(
      Effect.sync(() => feed.subscribe(threadId, () => Queue.offerUnsafe(changed, undefined))),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    for (;;) {
      const cards = yield* cardsOf(threadId, projectId);
      if (cards.length > 0) return cards;
      yield* Queue.take(changed);
    }
  },
  Effect.scoped,
  Effect.timeout('10 seconds'),
);

layer(Layer.effect(World, setup).pipe(Layer.provide(doorFixture())), { excludeTestServices: true, timeout: 30_000 })('start cost', (it) => {
  it.effect('the first real request and agent preview agree on priced prompt parts, and guidance mutations report their cost', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* World;
      const at = `project=${projectId}`;
      type Written = { block?: { name: string }; start?: { agent: string; chars: number; delta: number } };
      const group = (yield* world.op('create_block', { title: 'Fixture guidance' }, at)).body as Written;
      const prompt = (yield* world.op('create_block', { tags: ['rule'], parentId: group.block!.name, title: 'Keep the fixture data' }, at))
        .body as Written;
      expect(prompt.start!.delta).toBeGreaterThan(0);
      const code = (yield* world.op(
        'create_block',
        { tags: ['rule'], title: 'Name the gate by its role', sources: [{ kind: 'file', ref: 'gate.ts' }] },
        at,
      )).body as Written;
      expect(code.start).toEqual({ agent: prompt.start!.agent, chars: prompt.start!.chars, delta: 0 });

      const owners = world.runtime.owners;
      const { thread } = yield* birthsOf(owners).create({ projectId, createdBySessionId: null });
      const run = yield* turnsOf(owners).send(thread.id, projectId, 'Read the project.');
      yield* settledThread({ threadId: thread.id, projectId, runId: run.runId }).pipe(Effect.provide(owners));
      const cards = yield* carded(thread.id, projectId).pipe(Effect.provide(owners));
      expect(cards).toHaveLength(1);
      const card = cards[0]!;
      expect(card.chars).toBe(card.parts.reduce((sum, part) => sum + (part.chars ?? 0), 0));
      expect(card.inputTokens).toBe(10);
      const previewRead = yield* world.op('read_agent', { id: thread.agentId }, at);
      expect(previewRead.status).toBe(200);
      const preview = yield* Schema.decodeUnknownEffect(agentPreviewSchema)(previewRead.body);
      const part = (cost: { readonly parts: readonly { readonly id: string; readonly chars: number | null }[] }, id: string) =>
        cost.parts.find((one) => one.id === id)?.chars;
      for (const id of ['system', 'law', 'vocabulary', 'graph']) expect([id, part(card, id)]).toEqual([id, part(preview.start!, id)]);
    }),
  );
});
