import { expect } from 'bun:test';
import { join, resolve } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { Clock, Context, Data, Deferred, Effect, Fiber, FileSystem, Layer, Schedule, Stream } from 'effect';
import { TagmaApps } from '../../../tagma-apps/contract/service/supervision.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { agentsOffered } from '../../../threads/contract/wire/settings.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { birthsOf } from '../../../threads/testing/doubles.js';
import { makeDoorWorld } from '../doorFixture.js';
import { modelDefaults } from '../claudeLogin.js';

const FIXTURE = resolve(import.meta.dir, '../../../tagma-apps/testing/fixture.ts');
const APP = { 'x-tagma-caller': 'app:fixture' } as const;
const DONE: readonly LLMEvent[] = [
  { type: 'text-start', id: 'reply' },
  { type: 'text-delta', id: 'reply', text: 'Done.' },
  { type: 'text-end', id: 'reply' },
  { type: 'finish', reason: 'stop' },
];

class AwaitedStateNever extends Data.TaggedError('AwaitedStateNever')<{}> {}

let gate = Deferred.makeUnsafe<void>();
Deferred.doneUnsafe(gate, Effect.void);
const toolsOf = new Map<string, readonly string[]>();

const manifest = (title: string) =>
  JSON.stringify({
    id: 'fixture',
    title,
    process: { command: process.execPath, args: [FIXTURE] },
    contributes: {
      tools: [{ name: 'act', audience: 'own' }],
      agents: [{ id: 'player', path: 'agents/player.md' }],
      on: { ended: 'ended' },
    },
  });

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld({
    models: (standing) => ({
      ...standing,
      request: (input) => {
        const { web: _, ...request } = standing.request(input);
        return {
          ...request,
          stream: (streamed) => {
            if (input.runId !== undefined) toolsOf.set(input.runId, Object.keys(streamed.tools));
            return Stream.fromEffect(Effect.suspend(() => Deferred.await(gate))).pipe(Stream.flatMap(() => Stream.fromIterable(DONE)));
          },
        };
      },
    }),
  });
  const files = yield* FileSystem.FileSystem;
  const account = yield* Effect.acquireRelease(
    world.runtime.tokens.add('subscription', {
      accessToken: 'fixture-bearer',
      refreshToken: 'fixture-refresh',
      expiresAt: (yield* Clock.currentTimeMillis) + 3600000,
      scope: 'user:inference',
      account: { uuid: 'fixture-account', email: 'fixture@example.com' },
      organization: { uuid: 'fixture-org', name: 'Fixture' },
    }),
    (key) => world.runtime.signIns.remove('subscription', key).pipe(Effect.orDie),
  );
  const root = yield* world.directory('table');
  const projectId = yield* world.stealthProject(root);
  const scope = `project=${projectId}`;
  yield* modelDefaults(world, { provider: 'subscription', model: 'claude-sonnet-5-5', reasoning: 'low', account: null });
  const app = join(root, '.tagma-apps', 'fixture');
  yield* files.makeDirectory(join(app, 'agents'), { recursive: true });
  yield* files.writeFileString(
    join(app, 'agents', 'player.md'),
    '---\ndescription: Plays a seat.\ncapabilities: []\n---\nPlay your seat.\n',
  );
  yield* files.writeFileString(join(app, 'tagma-app.json'), manifest('Fixture'));
  const installed = yield* world.op('install_app', { id: 'fixture', enabled: true }, scope);
  expect(installed.body).toMatchObject({ app: { id: 'fixture', state: 'running' } });
  yield* Effect.addFinalizer(() => Context.get(world.runtime.owners, TagmaApps).uninstall({ projectId, id: 'fixture' }).pipe(Effect.orDie));
  return { world, account, root, projectId, scope };
});

class Table extends Context.Service<Table, Effect.Success<typeof setup>>()('testing/AgentsTable') {}

const journalOf = Effect.fnUntraced(function* () {
  const { world } = yield* Table;
  const files = yield* FileSystem.FileSystem;
  const text = yield* files.readFileString(join(world.dataHome, 'app-data', 'fixture', 'journal'));
  return text.trim().split('\n');
});

const until = <E, R>(holds: Effect.Effect<boolean, E, R>) =>
  Effect.retry(
    Effect.flatMap(holds, (standing) => (standing ? Effect.void : Effect.fail(new AwaitedStateNever()))),
    { schedule: Schedule.spaced('20 millis') },
  );

const ended = (runId: string) => Effect.map(journalOf(), (lines) => lines.some((line) => line.startsWith(`ended ${runId} `)));

const player = Effect.fnUntraced(function* () {
  const { world, account, scope } = yield* Table;
  const created = yield* world.op(
    'create_thread',
    { title: 'north', account, type: 'fixture.player', bindings: { app: 'fixture' } },
    scope,
    APP,
  );
  expect(created.status).toBe(200);
  return (created.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
});

const turn = Effect.fnUntraced(function* (threadId: string) {
  const { world, scope } = yield* Table;
  const started = yield* world.op('start_turn', { threadId, text: 'Play.', key: crypto.randomUUID() }, scope, APP);
  expect(started.body).toMatchObject({ status: 'started' });
  return (started.body as { runId: string }).runId;
});

layer(Layer.effect(Table, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('app agents', (it) => {
  it.effect(
    'the app’s agent is offered under its id in trust, holds the app’s own tools that a plain agent never sees, and its turn’s end reaches the process',
    () =>
      Effect.gen(function* () {
        const { world, account, projectId, scope } = yield* Table;
        const threadId = yield* player();
        const snapshot = yield* Context.get(world.runtime.owners, ThreadHarness).reads.snapshot(threadId);
        expect(snapshot.thread.authority.mode).toBe('trust');

        const runId = yield* turn(threadId);
        yield* until(ended(runId));
        expect(toolsOf.get(runId)).toContain('app__fixture__act');
        const lines = yield* journalOf();
        const [, pid] = lines.findLast((line) => line.startsWith('start '))!.split(' ');
        expect(lines.find((line) => line.startsWith(`ended ${runId} `))).toBe(`ended ${runId} completed ${pid} tagma`);

        const { thread } = yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, account });
        const plain = yield* turn(thread.id);
        yield* until(Effect.sync(() => toolsOf.has(plain)));
        expect(toolsOf.get(plain)).not.toContain('app__fixture__act');

        const library = yield* world.op('read_agent_library', {}, scope);
        expect((library.body as { definitions: readonly unknown[] }).definitions).toContainEqual(
          expect.objectContaining({ id: 'fixture.player', origin: expect.objectContaining({ scope: 'app' }), editable: false }),
        );
      }),
  );

  it.effect('an app’s agent spawned under a thread in review is born in trust when the type is offered to agents', () =>
    Effect.gen(function* () {
      const { world, account, projectId, scope } = yield* Table;
      yield* Context.get(world.runtime.graph, Settings).write({
        scope: 'project',
        projectId,
        key: agentsOffered.id,
        value: [{ type: 'fixture.player', to: 'agents' }],
      });
      const table = yield* world.op('create_thread', { title: 'table', account, approvalMode: 'review' }, scope, APP);
      const tableId = (table.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
      const seat = yield* world.op(
        'create_thread',
        { parent: tableId, task: '', type: 'fixture.player', bindings: { app: 'fixture' } },
        scope,
        APP,
      );
      const seatId = (seat.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
      const harness = Context.get(world.runtime.owners, ThreadHarness);
      expect((yield* harness.reads.snapshot(tableId)).thread.authority.mode).toBe('review');
      expect((yield* harness.reads.snapshot(seatId)).thread.authority.mode).toBe('trust');
    }),
  );

  it.effect('an end that falls on a restart of the process is delivered to the process that follows it', () =>
    Effect.gen(function* () {
      const { world, root, projectId, scope } = yield* Table;
      const files = yield* FileSystem.FileSystem;
      const apps = Context.get(world.runtime.owners, TagmaApps);
      const threadId = yield* player();
      gate = Deferred.makeUnsafe<void>();
      const runId = yield* turn(threadId);
      yield* until(Effect.sync(() => toolsOf.has(runId)));

      const held = yield* Effect.forkChild(apps.call('fixture', 'hold', {}, {}));
      yield* files.writeFileString(join(root, '.tagma-apps', 'fixture', 'tagma-app.json'), manifest('Fixture again'));
      const restarted = yield* Effect.forkChild(world.op('install_app', { id: 'fixture', enabled: true }, scope));
      yield* until(Effect.map(apps.list(projectId), (rows) => rows.find((row) => row.id === 'fixture')?.tools === 0));

      yield* Deferred.succeed(gate, undefined);
      yield* files.writeFileString(join(world.dataHome, 'app-data', 'fixture', 'release'), '');
      yield* Fiber.join(held);
      yield* Fiber.join(restarted);
      yield* until(ended(runId));
      const lines = yield* journalOf();
      const deliveredTo = lines.find((line) => line.startsWith(`ended ${runId} `))!.split(' ')[3];
      const exits = lines.filter((line) => line.startsWith('exit '));
      expect(exits.length).toBeGreaterThan(0);
      expect(lines.indexOf(`start ${deliveredTo}`)).toBeGreaterThan(lines.indexOf(exits.at(-1)!));
    }),
  );
});
