import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Context, Effect, Layer } from 'effect';
import { graphFixture, tempRootEffect } from '../composition/testing/graphFixture.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { PluginPlace, Plugins } from '../plugins/contract/service/supervision.js';
import { plugins as pluginsModule } from '../plugins/plugins.js';
import { Projects } from '../projects/contract/service/registry.js';
import { Settings } from '../settings/contract/service/values.js';
import { PluginSecrets } from './contract/service/secrets.js';
import { pluginSecretsLayer } from './layer.js';

const FIXTURE = resolve(import.meta.dir, 'testing/fixture.ts');
const SPAWN_BUDGET_MS = 30_000;
const TOKEN = 'tok-1234-abcdef';
const fixtureGraph = graphFixture();
const manifest = JSON.stringify({
  id: 'fixture',
  title: 'Fixture',
  process: { command: process.execPath, args: [FIXTURE] },
  contributes: { secrets: [{ name: 'API_TOKEN', description: 'The token of the service the plugin bridges.' }] },
});

const setup = Effect.gen(function* () {
  const demo = yield* Effect.acquireRelease(fixtureGraph.openEffect(), () => Effect.orDie(fixtureGraph.releaseEffect));
  const projectId = demo.projectId;
  const home = yield* tempRootEffect(demo.fixture, 'secrets-home-').pipe(Effect.provide(BunFileSystem.layer));
  const project = yield* Context.get(demo.context, Projects).byId(projectId);
  const root = join(project.rootPath, '.plugins', 'fixture');
  yield* Effect.promise(async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'plugin.json'), manifest);
  });
  const built = yield* Layer.build(pluginSecretsLayer.pipe(Layer.provideMerge(pluginsModule.lifetimes.installation))).pipe(
    Effect.provideService(Settings, Context.get(demo.context, Settings)),
    Effect.provideService(Projects, Context.get(demo.context, Projects)),
    Effect.provideService(PluginPlace, { home, server: 'http://127.0.0.1:1' }),
  );
  const plugins = Context.get(built, Plugins);
  const secrets = Context.get(built, PluginSecrets);
  const said = Effect.fnUntraced(function* (tool: string) {
    const result = yield* plugins.call('fixture', tool, {}, {});
    if (!('content' in result)) return yield* Effect.die('the fixture answered no content');
    const first = result.content[0];
    return first?.type === 'text' ? first.text : '';
  });
  const starts = () =>
    Effect.promise(
      async () =>
        (await readFile(join(home, 'plugin-data', 'fixture', 'journal'), 'utf8')).split('\n').filter((line) => line.startsWith('start '))
          .length,
    );
  return { plugins, secrets, projectId, home, said, starts, target: { projectId, plugin: 'fixture', name: 'API_TOKEN' } };
});

const refusal = Effect.fnUntraced(function* <E>(attempt: Effect.Effect<unknown, E>) {
  const failure = yield* Effect.flip(attempt);
  return failure instanceof GateRefusal ? failure.code : String(failure);
});

it.live(
  'a declared secret reads as missing until the operator gives it a value, which reaches the process, is masked in what it answers, and restarts it once per change',
  () =>
    Effect.gen(function* () {
      const { plugins, secrets, projectId, said, starts, target } = yield* setup;
      yield* plugins.install({ projectId, id: 'fixture', enabled: true });
      expect(yield* secrets.read(projectId)).toEqual([
        {
          plugin: 'fixture',
          title: 'Fixture',
          secrets: [{ name: 'API_TOKEN', description: 'The token of the service the plugin bridges.', set: false }],
          missing: 1,
        },
      ]);
      expect(yield* said('length')).toBe('absent');
      expect(yield* starts()).toBe(1);
      expect(yield* refusal(secrets.set({ ...target, name: 'OTHER' }, TOKEN))).toBe('plugin-secret-unknown');
      expect(yield* refusal(secrets.set(target, ''))).toBe('secret-value-invalid');
      expect(yield* refusal(secrets.set(target, 'a\0b'))).toBe('secret-value-invalid');
      expect(yield* secrets.set(target, TOKEN)).toMatchObject({ name: 'API_TOKEN', set: true });
      expect(yield* said('length')).toBe(String(TOKEN.length));
      expect(yield* said('reveal')).toBe('token=[redacted]');
      expect(JSON.stringify(yield* plugins.call('fixture', 'keyed', {}, {}))).not.toContain(TOKEN);
      expect(yield* starts()).toBe(2);
      expect((yield* secrets.read(projectId))[0]).toMatchObject({ missing: 0 });
      yield* secrets.set(target, TOKEN);
      expect(yield* starts()).toBe(2);
      expect(yield* secrets.remove(target)).toMatchObject({ set: false });
      expect(yield* said('length')).toBe('absent');
      expect(yield* starts()).toBe(3);
      yield* secrets.set(target, TOKEN);
      yield* plugins.uninstall({ projectId, id: 'fixture' });
      expect(yield* refusal(secrets.set(target, TOKEN))).toBe('plugin-secret-unknown');
      expect(yield* secrets.remove(target)).toMatchObject({ set: false });
      expect(yield* refusal(secrets.remove(target))).toBe('plugin-secret-unknown');
    }),
  SPAWN_BUDGET_MS,
);

it.live(
  'a plugin whose secrets cannot be read does not start, and the failure does not quote the store',
  () =>
    Effect.gen(function* () {
      const { plugins, projectId, home } = yield* setup;
      yield* Effect.promise(() =>
        writeFile(join(home, 'plugin-secrets.json'), '{"plugins": {"fixture": {"API_TOKEN": 7}}}  garbage-token-5521'),
      );
      const row = yield* plugins.install({ projectId, id: 'fixture', enabled: true });
      expect(row.state).toBe('failed');
      expect(row.failure ?? '').toContain('secret store');
      expect(JSON.stringify(row)).not.toContain('garbage-token-5521');
      expect(yield* Effect.promise(() => Bun.file(join(home, 'plugin-data', 'fixture', 'journal')).exists())).toBe(false);
    }),
  SPAWN_BUDGET_MS,
);
