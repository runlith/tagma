import { expect } from 'bun:test';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from '@runlith/effect-test';
import { Context, Data, Effect, Schedule, Stream } from 'effect';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { writePlugin } from '../../../plugin-formats/tagma/testing/folder.js';
import { PluginHost } from '../../../plugin-host/contract/service/supervision.js';
import { PluginActions } from '../../../views/contract/service/actions.js';
import type { PluginActionState } from '../../../views/contract/wire/actions.js';
import { makeDoorWorld } from '../doorFixture.js';

const ENTRY = fileURLToPath(import.meta.resolve('@runlith/tagma/plugin'));
const SDK = resolve(dirname(ENTRY), '../..');
const CLI = join(dirname(ENTRY), 'cli.ts');
const FIXTURES = { keys: join(import.meta.dir, 'actionsFixture.ts'), stray: join(import.meta.dir, 'actionsRefusedFixture.ts') };
const UNDECLARED = 'contributes.shortcuts: names sync';

class NeverHeld extends Data.TaggedError('NeverHeld')<{}> {}

const authored = (folder: string, fixture: string) =>
  Effect.promise(async () => {
    await writeFile(join(folder, 'plugin.ts'), await readFile(fixture, 'utf8'));
    await rm(join(folder, 'plugin.test.ts'));
    await mkdir(join(folder, 'ui'));
    await writeFile(join(folder, 'ui', 'board.html'), '<!doctype html><p>board</p>');
    await mkdir(join(folder, 'node_modules', '@runlith'), { recursive: true });
    await mkdir(join(folder, 'node_modules', '@types'), { recursive: true });
    await symlink(SDK, join(folder, 'node_modules', '@runlith', 'tagma'));
    await symlink(join(SDK, 'node_modules', '@types', 'bun'), join(folder, 'node_modules', '@types', 'bun'));
    await symlink(join(SDK, 'node_modules', 'effect'), join(folder, 'node_modules', 'effect'));
  });

it.live(
  'a plugin written with the SDK offers its actions and proposed chords before any process ran, runs an action for the operator in a project, keeps its rank through an update, and a shortcut naming an undeclared action fails the build and the install alike',
  () =>
    Effect.gen(function* () {
      const world = yield* makeDoorWorld({ own: 'it installs plugins for the machine' });
      const projectId = yield* world.stealthProject(yield* world.directory('keys-project'));
      const scope = `project=${projectId}`;
      const host = Context.get(world.runtime.owners, PluginHost);
      const actions = Context.get(world.runtime.owners, PluginActions);
      const standing = (state: string) =>
        Effect.retry(
          Effect.flatMap(
            Effect.sync(() => host.reading('keys')?.state === state),
            (held) => (held ? Effect.void : Effect.fail(new NeverHeld())),
          ),
          { schedule: Schedule.spaced('20 millis') },
        );
      const listed = (holds: (state: PluginActionState) => boolean) =>
        Effect.map(Stream.runCollect(Stream.take(Stream.filter(actions.sets, holds), 1)), ([state]) => state!);
      const built = Effect.fnUntraced(function* (id: 'keys' | 'stray') {
        const created = yield* world.op('create_plugin', { id, title: id }, scope);
        const folder = (created.body as { readonly path: string }).path;
        yield* authored(folder, FIXTURES[id]);
        const build = yield* spawnedEffect([process.execPath, CLI, 'build', folder], { cwd: folder });
        return { folder, build, said: `${build.stdout}${build.stderr}` };
      });
      yield* Effect.addFinalizer(() =>
        Effect.forEach(['keys', 'second'], (id) => world.op('uninstall_plugin', { id }, scope), { discard: true }).pipe(Effect.orDie),
      );

      const keys = yield* built('keys');
      expect({ code: keys.build.exitCode, said: keys.said }).toMatchObject({ code: 0 });
      expect(yield* world.op('install_plugin', { source: keys.folder }, scope)).toMatchObject({ status: 200 });
      yield* standing('idle');
      const first = yield* listed((state) => state.plugins.some((set) => set.plugin === 'keys'));
      expect(first.plugins).toEqual([
        {
          plugin: 'keys',
          title: 'Keys',
          rank: 0,
          projects: [projectId],
          actions: [
            { id: 'sync', kind: 'action', title: 'Sync boards', keys: [{ keys: 'Mod+Alt+S', global: false }] },
            { id: 'section:board', kind: 'section', title: 'Boards', keys: [{ keys: 'Mod+Alt+G', global: true }] },
          ],
        },
      ]);
      expect(host.reading('keys')).toMatchObject({ state: 'idle', restarts: 0 });

      expect((yield* world.op('run_plugin_action', { plugin: 'keys', action: 'sync' }, scope)).body).toEqual({
        status: 'ok',
        said: `Synced from project ${projectId}`,
      });
      expect(host.reading('keys')?.state).toBe('running');
      expect((yield* world.op('run_plugin_action', { plugin: 'keys', action: 'nope' }, scope)).body).toMatchObject({
        code: 'plugin-action-unknown',
      });

      const second = yield* world.directory('second-plugin');
      yield* Effect.promise(() =>
        writePlugin(second, {
          id: 'second',
          contributes: { views: [{ id: 'board', entry: 'ui/board.html' }], surfaces: [{ view: 'board', title: 'Second' }] },
        }),
      );
      expect(yield* world.op('install_plugin', { source: second }, scope)).toMatchObject({ status: 200 });
      expect(yield* world.op('install_plugin', { source: keys.folder }, scope)).toMatchObject({ status: 200 });
      const updated = yield* listed((state) => state.plugins.length === 2);
      expect(updated.plugins.map((set) => [set.plugin, set.rank])).toEqual([
        ['keys', 0],
        ['second', 1],
      ]);

      const stray = yield* built('stray');
      expect(stray.build.exitCode).not.toBe(0);
      expect(stray.said).toContain(UNDECLARED);
      const refused = yield* world.directory('stray-plugin');
      yield* Effect.promise(() =>
        writePlugin(refused, { id: 'stray', contributes: { shortcuts: [{ keys: 'Mod+Alt+S', action: 'sync' }] } }),
      );
      expect((yield* world.op('install_plugin', { source: refused }, scope)).body).toMatchObject({
        code: 'plugin-refused',
        reason: expect.stringContaining(UNDECLARED),
      });
      const tool = (audience: string) => ({ name: 'sync', audience, description: 'Syncs.', inputSchema: { type: 'object' } });
      const action = { id: 'sync', title: 'Sync', tool: 'sync' };
      for (const [at, { contributes, reason }] of [
        { contributes: { tools: [tool('agents')], actions: [action] }, reason: 'contributes.actions: the tool sync is offered to agents' },
        {
          contributes: {
            tools: [tool('tagma')],
            actions: [action],
            shortcuts: [
              { keys: 'Mod+Alt+S', action: 'sync' },
              { keys: 'Alt+Mod+S', action: 'sync' },
            ],
          },
          reason: 'the chord Mod+Alt+S is listed twice',
        },
        {
          contributes: { tools: [tool('tagma')], actions: [action], shortcuts: [{ keys: 'S', action: 'sync' }] },
          reason: 'needs Mod, Cmd, Ctrl or Alt',
        },
      ].entries()) {
        const root = yield* world.directory(`refused-${at}`);
        yield* Effect.promise(() => writePlugin(root, { id: `refused-${at}`, contributes }));
        expect((yield* world.op('install_plugin', { source: root }, scope)).body).toMatchObject({
          code: 'plugin-refused',
          reason: expect.stringContaining(reason),
        });
      }
    }),
);
