import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer, Schema, Stream } from 'effect';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { nativeLeads, subscriptionLogin, modelDefaults } from '../claudeLogin.js';
import { projectLeaving } from '../doorFixture.js';
import { birthsOf, listOf, turnsOf } from '../../../threads/testing/doubles.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { TURN_OPERATIONS } from '../../../threads/contract/wire/operations/turns.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';

const DEALER = { 'x-tagma-caller': 'dealer' } as const;
const APP = { 'x-tagma-caller': 'app:poker' } as const;
const decodeSnapshot = Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema);
const decodeStart = Schema.decodeUnknownEffect(knownAnswer(TURN_OPERATIONS.start_turn.answer));
const decodeStatuses = Schema.decodeUnknownEffect(knownAnswer(TURN_OPERATIONS.read_statuses.answer));

const fixture = doorFixture({
  models: (standing) => ({
    ...standing,
    request: (input) => ({ ...standing.request(input), web: undefined, stream: () => Stream.never }),
  }),
});
const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const account = yield* subscriptionLogin(world);
  yield* nativeLeads(world, account);
  const projectId = yield* world.plainProject();
  const elsewhere = yield* world.plainProject();
  yield* projectLeaving(world, projectId, elsewhere);
  const catalog = yield* Context.get(world.runtime.owners, ProviderRegistry).catalog;
  return { world, account, projectId, elsewhere, catalog };
});

class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/ExternalCallerWorld') {}

const op = (id: string, input: unknown, headers?: Readonly<Record<string, string>>) =>
  Effect.flatMap(World, ({ world, projectId }) => world.op(id, input, `project=${projectId}`, headers));
const born = Effect.fnUntraced(function* () {
  const { world, projectId, account } = yield* World;
  return yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, title: 'table', account });
});
const started = Effect.fnUntraced(function* (threadId: string, key: string) {
  const response = yield* op('start_turn', { threadId, text: 'Deal.', key }, DEALER);
  expect(response.status).toBe(200);
  const answer = yield* decodeStart(response.body);
  if (answer.status !== 'started') return yield* Effect.die(new Error(`the idle thread was ${answer.status}`));
  return answer.runId;
});

layer(Layer.effect(World, setup).pipe(Layer.provide(fixture)), { excludeTestServices: true })('external thread callers', (it) => {
  it.effect('an app owns its bound root and child through idle birth, running archive and restoration', () =>
    Effect.gen(function* () {
      const { world, projectId, account } = yield* World;
      const bindings = { app: 'poker', poker: 'table-1/north' };
      const created = yield* op('create_thread', { title: 'poker player', account, bindings }, APP);
      expect(created.status).toBe(200);
      const { snapshot } = yield* decodeSnapshot(created.body);
      expect(snapshot).toMatchObject({ activeRun: null, latestRun: null });
      expect(yield* listOf(world.runtime.owners).row(snapshot.thread.id)).toMatchObject({ projectId, bindings, parentThreadId: null });
      const childBindings = { app: 'other', poker: 'table-1/south' };
      const child = yield* op('create_thread', { parent: snapshot.thread.id, task: '', bindings: childBindings }, APP);
      expect(child.status).toBe(200);
      const childId = (yield* decodeSnapshot(child.body)).snapshot.thread.id;
      expect(yield* listOf(world.runtime.owners).row(childId)).toMatchObject({
        projectId,
        bindings: childBindings,
        parentThreadId: snapshot.thread.id,
      });
      expect((yield* listOf(world.runtime.owners).row(snapshot.thread.id))?.bindings).toEqual(bindings);
      const threadId = snapshot.thread.id;
      const ids = [threadId, childId];
      const listing = (set: 'live' | 'archived') => op('list_threads', { ids, set, shape: 'rows', limit: 2 });
      const live = yield* listing('live');
      expect(live).toMatchObject({ status: 200, body: { total: 2 } });
      expect((yield* op('start_turn', { threadId, text: 'Play.', key: 'retire-player' }, APP)).body).toMatchObject({
        status: 'started',
      });
      const archived = yield* op('archive_thread', { threadId }, APP);
      expect(archived.status).toBe(200);
      expect(archived.body).toMatchObject({ status: 'archived', threadId });
      expect((yield* listing('live')).body).toMatchObject({ rows: [], total: 0 });
      expect((yield* listing('archived')).body).toMatchObject({ total: 2 });
      expect((yield* op('read_statuses', { threads: [threadId], limit: 1 }, APP)).body).toMatchObject({
        rows: [{ outcome: 'found', status: { life: 'idle', runId: null, ending: { status: 'aborted' } } }],
      });
      const restored = yield* op('archive_thread', { threadId, archived: false });
      expect(restored.status).toBe(200);
      expect(restored.body).toMatchObject({ status: 'unarchived', threadId });
      expect((yield* listing('live')).body).toMatchObject({ total: 2 });
      expect((yield* listing('archived')).body).toMatchObject({ rows: [], total: 0 });
    }),
  );

  it.effect('an app root uses its agent definition model, and a definition without a model keeps the operator defaults', () =>
    Effect.gen(function* () {
      const { world, account, catalog } = yield* World;

      const haiku = {
        provider: 'subscription',
        model: 'claude-haiku-5-5',
        reasoning: 'low',
        account,
        switches: { reasoningDisplay: 'omitted' },
      };
      const standing = {
        provider: 'openai-oauth',
        model: 'gpt-6.1-sol',
        reasoning: 'high',
        account: null,
        switches: { serviceTier: 'priority' },
      };
      const providerDefault = {
        provider: 'subscription',
        model: catalog.models.defaultTextModelId('subscription'),
        reasoning: 'low',
        account: null,
        switches: {},
      };
      yield* modelDefaults(world, haiku);
      expect((yield* op('set_model_defaults', standing)).status).toBe(200);
      for (const [name, model, selected] of [
        ['player-haiku', 'model:\n  provider: subscription\n  model: claude-haiku-5-5\n  reasoning: low\n', haiku],
        ['player-default', '', standing],
        ['player-provider', 'model:\n  provider: subscription\n  reasoning: low\n', providerDefault],
      ] as const) {
        expect(
          (yield* op('save_agent', {
            name,
            scope: 'project',
            revision: null,
            source: `---\ndescription: Plays a hand\ncapabilities: []\n${model}---\nPlay the hand.\n`,
          })).status,
        ).toBe(200);
        const created = yield* op('create_thread', { type: name, bindings: { poker: name }, account: selected.account ?? undefined }, APP);
        expect(created.status).toBe(200);
        const { snapshot } = yield* decodeSnapshot(created.body);
        expect(snapshot.activeRun).toBeNull();
        const row = yield* listOf(world.runtime.owners).row(snapshot.thread.id);
        expect(row).toMatchObject(selected);
        expect(row?.switches).toEqual(selected.switches);
      }
    }),
  );

  it.effect('an app root refuses an unserved model in its definition with a typed reason and a way forward', () =>
    Effect.gen(function* () {
      expect(
        (yield* op('save_agent', {
          name: 'player-unserved',
          scope: 'project',
          revision: null,
          source:
            '---\ndescription: Plays a hand\ncapabilities: []\nmodel:\n  provider: subscription\n  model: unserved\n---\nPlay the hand.\n',
        })).status,
      ).toBe(200);
      const refused = yield* op('create_thread', { type: 'player-unserved' }, APP);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        code: 'model-unserved',
        reason: expect.any(String),
        unblock: expect.arrayContaining([expect.any(String)]),
      });
    }),
  );

  it.effect(
    'app archiving refuses unbound or differently bound threads, other external callers, and the wrong project without changing state',
    () =>
      Effect.gen(function* () {
        const { world, account, elsewhere } = yield* World;
        const { thread: unbound } = yield* born();
        const created = yield* op('create_thread', { account, bindings: { app: 'other' } }, APP);
        expect(created.status).toBe(200);
        const otherId = (yield* decodeSnapshot(created.body)).snapshot.thread.id;
        for (const threadId of [unbound.id, otherId]) {
          for (const archived of [true, false]) {
            const refused = yield* op('archive_thread', { threadId, archived }, APP);
            expect(refused.status).toBe(409);
            expect(refused.body).toMatchObject({
              code: 'app-thread-mismatch',
              reason: expect.any(String),
              unblock: expect.arrayContaining([expect.any(String)]),
            });
          }
          expect((yield* listOf(world.runtime.owners).row(threadId))?.archivedAt).toBeNull();
        }
        for (const name of ['dealer', 'app:']) {
          const refused = yield* op('archive_thread', { threadId: otherId }, { 'x-tagma-caller': name });
          expect(refused.status).toBe(409);
          expect(refused.body).toMatchObject({ code: 'external-refused' });
        }
        const foreign = yield* world.op('archive_thread', { threadId: otherId }, `project=${elsewhere}`, {
          'x-tagma-caller': 'app:other',
        });
        expect(foreign.status).toBe(409);
        expect(foreign.body).toMatchObject({ code: 'place-mismatch' });
        const missing = yield* op('archive_thread', { threadId: 'no-such-thread' }, APP);
        expect(missing.status).toBe(409);
        expect(missing.body).toMatchObject({ code: 'not-found' });
        expect((yield* listOf(world.runtime.owners).row(otherId))?.archivedAt).toBeNull();
      }),
  );

  it.effect('an external caller wakes once by key and reads the stopped run through status and endings', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* World;
      const { thread } = yield* born();
      const wake = (text: string) => op('start_turn', { threadId: thread.id, text, key: 'deal-1' }, DEALER);
      const first = yield* wake('Deal the next hand.');
      expect(first.status).toBe(200);
      const answer = yield* decodeStart(first.body);
      expect(answer).toMatchObject({ status: 'started', acted: true });
      const runId = answer.runId;
      expect((yield* wake('Deal the next hand.')).body).toEqual({ status: 'started', runId, acted: false });
      const conflict = yield* wake('Deal twice.');
      expect(conflict.status).toBeGreaterThanOrEqual(400);
      expect(conflict.body).toMatchObject({ code: 'key-reused' });
      yield* turnsOf(world.runtime.owners).stop(thread.id, projectId, runId);
      expect((yield* op('read_statuses', { threads: [thread.id], limit: 1 }, DEALER)).body).toMatchObject({
        rows: [{ outcome: 'found', status: { life: 'idle', runId: null, ending: { runId, status: 'aborted', stoppedBy: 'reader' } } }],
      });
      const ended = yield* op('read_endings', { threads: [thread.id, 'no-such-thread'], limit: 2 }, DEALER);
      expect(ended.status).toBe(200);
      expect(ended.body).toMatchObject({
        total: 2,
        cursor: null,
        rows: [
          { threadId: thread.id, outcome: 'found', endings: [{ runId, threadId: thread.id, status: 'aborted' }] },
          { threadId: 'no-such-thread', outcome: 'not-found' },
        ],
      });
    }),
  );

  it.effect('an external caller reads the status of the named threads in pages and is refused what is not offered to it', () =>
    Effect.gen(function* () {
      const { thread } = yield* born();
      const read = yield* op('read_statuses', { threads: [thread.id, 'no-such-thread'], limit: 1 }, DEALER);
      expect(read.status).toBe(200);
      const page = yield* decodeStatuses(read.body);
      expect(page).toMatchObject({ status: 'ok', total: 2, rows: [{ threadId: thread.id, outcome: 'found' }] });
      expect(page.cursor).not.toBeNull();
      const rest = yield* op('read_statuses', { threads: [thread.id, 'no-such-thread'], limit: 1, cursor: page.cursor }, DEALER);
      expect(rest.body).toMatchObject({ rows: [{ threadId: 'no-such-thread', outcome: 'not-found' }], total: 2, cursor: null });
      const other = yield* op('read_statuses', { threads: [thread.id, 'different-missing'], limit: 1 }, DEALER);
      const otherPage = yield* decodeStatuses(other.body);
      expect(
        (yield* op('read_statuses', { threads: [thread.id, 'no-such-thread'], limit: 1, cursor: otherPage.cursor }, DEALER)).body,
      ).toMatchObject({ code: 'cursor-stale' });
      expect((yield* op('stop_run', { threadId: thread.id }, DEALER)).body).toMatchObject({ code: 'external-refused' });
    }),
  );

  it.effect(
    'redelivering an ending takes only a run its thread holds, answers a notification that has not given up as such, and is gated by project',
    () =>
      Effect.gen(function* () {
        const { world, projectId, elsewhere } = yield* World;
        const { thread } = yield* born();
        const { thread: other } = yield* born();
        const runId = yield* started(thread.id, 'deal-redeliver');
        yield* turnsOf(world.runtime.owners).stop(thread.id, projectId, runId);
        expect((yield* op('redeliver_ending', { threadId: thread.id, runId })).body).toMatchObject({ status: 'not-exhausted' });
        expect((yield* op('redeliver_ending', { threadId: other.id, runId })).body).toMatchObject({ status: 'run-not-found' });
        expect((yield* world.op('redeliver_ending', { threadId: thread.id, runId }, `project=${elsewhere}`)).body).toMatchObject({
          code: 'place-mismatch',
        });
      }),
  );
});
