import { expect } from 'bun:test';
import { join, resolve } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { Clock, Context, Data, Deferred, Effect, Fiber, FileSystem, Layer, Schedule, Stream } from 'effect';
import { LoadPluginTitles } from '../../../executions/contract/service/owners.js';
import { MANIFEST } from '../../../plugin-formats/tagma/contract/wire/manifest.js';
import { manifestText, writePlugin } from '../../../plugin-formats/tagma/testing/folder.js';
import { PluginHost } from '../../../plugin-host/contract/service/supervision.js';
import { fixtureEntries } from '../../../plugin-host/testing/tools.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { agentsOffered } from '../../../threads/contract/wire/settings.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { birthsOf } from '../../../threads/testing/doubles.js';
import { makeDoorWorld } from '../doorFixture.js';
import { modelDefaults } from '../claudeLogin.js';

const FIXTURE = resolve(import.meta.dir, '../../../plugin-host/testing/fixture.ts');
const PLUGIN = { 'x-tagma-caller': 'plugin:fixture' } as const;
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

const folder = (title: string) => ({
  id: 'fixture',
  title,
  program: FIXTURE,
  contributes: {
    tools: fixtureEntries({ act: 'own' }),
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
  const plugin = yield* world.directory('fixture-plugin');
  yield* files.makeDirectory(join(plugin, 'agents'), { recursive: true });
  yield* files.writeFileString(
    join(plugin, 'agents', 'player.md'),
    '---\ndescription: Plays a seat.\ncapabilities: []\n---\nPlay your seat.\n',
  );
  yield* Effect.promise(() => writePlugin(plugin, folder('Fixture')));
  const installed = yield* world.op('install_plugin', { source: plugin }, scope);
  expect(installed.body).toMatchObject({ plugin: { id: 'fixture' } });
  yield* Effect.addFinalizer(() => world.op('uninstall_plugin', { id: 'fixture' }, scope).pipe(Effect.orDie));
  const host = Context.get(world.runtime.owners, PluginHost);
  yield* Effect.repeat(
    Effect.sync(() => host.reading('fixture')),
    {
      schedule: Schedule.spaced('20 millis'),
      until: (row) => row?.state === 'idle',
    },
  );
  return { world, host, account, plugin, projectId, scope };
});

class Table extends Context.Service<Table, Effect.Success<typeof setup>>()('testing/AgentsTable') {}

const journalOf = Effect.fnUntraced(function* () {
  const { world } = yield* Table;
  const files = yield* FileSystem.FileSystem;
  const text = yield* files.readFileString(join(world.dataHome, 'agent-plugin-data', 'fixture', 'journal'));
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
    { title: 'north', account, type: 'fixture.player', bindings: { plugin: 'fixture' } },
    scope,
    PLUGIN,
  );
  expect(created.status).toBe(200);
  return (created.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
});

const turn = Effect.fnUntraced(function* (threadId: string) {
  const { world, scope } = yield* Table;
  const started = yield* world.op('start_turn', { threadId, text: 'Play.', key: crypto.randomUUID() }, scope, PLUGIN);
  expect(started.body).toMatchObject({ status: 'started' });
  return (started.body as { runId: string }).runId;
});

layer(Layer.effect(Table, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('plugin agents', (it) => {
  it.effect(
    'the plugin’s agent is offered under its id in trust, holds the plugin’s own tools that a plain agent never sees, and its turn’s end reaches the process',
    () =>
      Effect.gen(function* () {
        const { world, account, projectId, scope } = yield* Table;
        const threadId = yield* player();
        const snapshot = yield* Context.get(world.runtime.owners, ThreadHarness).reads.snapshot(threadId);
        expect(snapshot.thread.authority.mode).toBe('trust');

        const runId = yield* turn(threadId);
        yield* until(ended(runId));
        expect(toolsOf.get(runId)).toContain('plugin__fixture__act');
        const lines = yield* journalOf();
        const [, pid] = lines.findLast((line) => line.startsWith('start '))!.split(' ');
        expect(lines.find((line) => line.startsWith(`ended ${runId} `))).toBe(`ended ${runId} completed ${pid} tagma`);

        const { thread } = yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, account });
        const plain = yield* turn(thread.id);
        yield* until(Effect.sync(() => toolsOf.has(plain)));
        expect(toolsOf.get(plain)).not.toContain('plugin__fixture__act');

        const library = yield* world.op('read_agent_library', {}, scope);
        expect((library.body as { definitions: readonly unknown[] }).definitions).toContainEqual(
          expect.objectContaining({ id: 'fixture.player', origin: expect.objectContaining({ scope: 'plugin' }), editable: false }),
        );
      }),
  );

  it.effect('a plugin’s agent spawned under a thread in review is born in trust when the type is offered to agents', () =>
    Effect.gen(function* () {
      const { world, account, projectId, scope } = yield* Table;
      yield* Context.get(world.runtime.graph, Settings).write({
        scope: 'project',
        projectId,
        key: agentsOffered.id,
        value: [{ type: 'fixture.player', to: 'agents' }],
      });
      const table = yield* world.op('create_thread', { title: 'table', account, approvalMode: 'review' }, scope, PLUGIN);
      const tableId = (table.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
      const seat = yield* world.op(
        'create_thread',
        { parent: tableId, task: '', type: 'fixture.player', bindings: { plugin: 'fixture' } },
        scope,
        PLUGIN,
      );
      const seatId = (seat.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
      const harness = Context.get(world.runtime.owners, ThreadHarness);
      expect((yield* harness.reads.snapshot(tableId)).thread.authority.mode).toBe('review');
      expect((yield* harness.reads.snapshot(seatId)).thread.authority.mode).toBe('trust');
    }),
  );

  it.effect('an end that falls on a restart of the process is delivered to the process that follows it', () =>
    Effect.gen(function* () {
      const { world, host, plugin, projectId } = yield* Table;
      const files = yield* FileSystem.FileSystem;
      const threadId = yield* player();
      gate = Deferred.makeUnsafe<void>();
      const runId = yield* turn(threadId);
      yield* until(Effect.sync(() => toolsOf.has(runId)));

      const held = yield* Effect.forkChild(host.call('fixture', 'hold', {}, {}));
      yield* files.writeFileString(join(plugin, MANIFEST), manifestText(folder('Fixture again')));
      const titles = Context.get(world.runtime.owners, LoadPluginTitles);
      yield* until(Effect.map(titles.read(projectId), (read) => read.get('fixture') === 'Fixture again'));

      yield* Deferred.succeed(gate, undefined);
      yield* files.writeFileString(join(world.dataHome, 'agent-plugin-data', 'fixture', 'release'), '');
      yield* Fiber.join(held);
      yield* until(ended(runId));
      const lines = yield* journalOf();
      const deliveredTo = lines.find((line) => line.startsWith(`ended ${runId} `))!.split(' ')[3];
      const exits = lines.filter((line) => line.startsWith('exit '));
      expect(exits.length).toBeGreaterThan(0);
      expect(lines.indexOf(`start ${deliveredTo}`)).toBeGreaterThan(lines.indexOf(exits.at(-1)!));
    }),
  );

  it.effect('removing the only project that enables a plugin stops its process', () =>
    Effect.gen(function* () {
      const { world, host } = yield* Table;
      const projectId = yield* world.stealthProject(yield* world.directory('lone'));
      const plugin = yield* world.directory('lone-plugin');
      yield* Effect.promise(() =>
        writePlugin(plugin, { id: 'lone', title: 'Lone', program: FIXTURE, contributes: { tools: fixtureEntries({}) } }),
      );
      expect((yield* world.op('install_plugin', { source: plugin }, `project=${projectId}`)).status).toBe(200);
      yield* until(Effect.sync(() => host.reading('lone')?.state === 'idle'));
      expect((yield* world.op('remove_project', { ref: String(projectId) })).status).toBe(200);
      yield* until(Effect.sync(() => host.reading('lone') === undefined));
    }),
  );
});
