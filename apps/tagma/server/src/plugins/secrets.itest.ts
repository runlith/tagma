import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Context, Effect, Layer } from 'effect';
import { graphFixture, tempRootEffect } from '../composition/testing/graphFixture.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Projects } from '../projects/contract/service/registry.js';
import { Secrets, SecretsPlace } from '../secrets/contract/service/secrets.js';
import { secrets as secretsModule } from '../secrets/secrets.js';
import { Settings } from '../settings/contract/service/values.js';
import { PluginPlace, Plugins } from './contract/service/supervision.js';
import { plugins as pluginsModule } from './plugins.js';

const FIXTURE = resolve(import.meta.dir, 'testing/keyed.ts');
const FORMER = 'tok-1234-before"move';
const TOKEN = 'tok-5678-abcdef';
const fixtureGraph = graphFixture();
const manifest = JSON.stringify({
  id: 'fixture',
  title: 'Fixture',
  process: { command: process.execPath, args: [FIXTURE] },
  contributes: { secrets: [{ name: 'API_TOKEN', description: 'The token of the service the app bridges.' }] },
});

const setup = Effect.fnUntraced(function* (seed: (home: string) => Promise<void>) {
  const demo = yield* Effect.acquireRelease(fixtureGraph.openEffect(), () => Effect.orDie(fixtureGraph.releaseEffect));
  const projectId = demo.projectId;
  const home = yield* tempRootEffect(demo.fixture, 'secrets-home-').pipe(Effect.provide(BunFileSystem.layer));
  const project = yield* Context.get(demo.context, Projects).byId(projectId);
  const root = join(project.rootPath, '.plugins', 'fixture');
  yield* Effect.promise(async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'plugin.json'), manifest);
    await seed(home);
  });
  const stored = secretsModule.lifetimes.installation.pipe(Layer.provide(Layer.succeed(SecretsPlace, { home })));
  const built = yield* Layer.build(
    pluginsModule.lifetimes.installation.pipe(Layer.provideMerge(Layer.merge(stored, BunFileSystem.layer))),
  ).pipe(
    Effect.provideService(Settings, Context.get(demo.context, Settings)),
    Effect.provideService(Projects, Context.get(demo.context, Projects)),
    Effect.provideService(PluginPlace, { home, server: 'http://127.0.0.1:1' }),
  );
  const plugins = Context.get(built, Plugins);
  const secrets = Context.get(built, Secrets);
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
  const file = (name: string) => Effect.promise(() => Bun.file(join(home, name)).exists());
  const kept = () => Effect.promise(async () => JSON.parse(await readFile(join(home, 'secrets.json'), 'utf8')) as unknown);
  return { plugins, secrets, projectId, said, starts, file, kept, target: { owner: 'plugins', id: 'fixture', name: 'API_TOKEN' } };
});

const refusal = Effect.fnUntraced(function* <E>(attempt: Effect.Effect<unknown, E>) {
  const failure = yield* Effect.flip(attempt);
  return failure instanceof GateRefusal ? failure.code : String(failure);
});

it.live(
  'a value kept in the former file reaches the process from the secret store, and each change restarts it once, masked, until uninstalling drops it',
  () =>
    Effect.gen(function* () {
      const { plugins, secrets, projectId, said, starts, file, kept, target } = yield* setup((home) =>
        writeFile(join(home, 'plugin-secrets.json'), JSON.stringify({ plugins: { fixture: { API_TOKEN: FORMER } } })),
      );
      yield* plugins.install({ projectId, id: 'fixture', enabled: true });
      expect(yield* said('length')).toBe(String(FORMER.length));
      expect(yield* file('plugin-secrets.json')).toBe(false);
      expect(yield* kept()).toEqual({ owners: { plugins: { fixture: { values: { API_TOKEN: FORMER } } } } });
      const read = yield* secrets.read(projectId, 'plugins', undefined);
      expect(read).toEqual([
        {
          owner: 'plugins',
          id: 'fixture',
          title: 'Fixture',
          secrets: [{ name: 'API_TOKEN', description: 'The token of the service the app bridges.', set: true }],
          missing: 0,
        },
      ]);
      expect(yield* said('reveal')).toBe('token=[redacted]');
      expect(JSON.stringify(yield* plugins.call('fixture', 'keyed', {}, {}))).not.toContain('before\\"move');
      expect(yield* refusal(secrets.set(projectId, { ...target, name: 'OTHER' }, TOKEN))).toBe('secret-unknown');
      expect(yield* refusal(secrets.set(projectId, target, 'a\0b'))).toBe('secret-value-invalid');
      expect(yield* secrets.set(projectId, target, TOKEN)).toEqual({
        name: 'API_TOKEN',
        description: 'The token of the service the app bridges.',
        set: true,
      });
      expect(yield* said('length')).toBe(String(TOKEN.length));
      expect(yield* starts()).toBe(2);
      yield* secrets.set(projectId, target, TOKEN);
      expect(yield* starts()).toBe(2);
      expect(yield* secrets.remove(projectId, target)).toMatchObject({ set: false });
      expect(yield* said('length')).toBe('absent');
      expect(yield* starts()).toBe(3);
      yield* secrets.set(projectId, target, TOKEN);
      yield* plugins.uninstall({ projectId, id: 'fixture' });
      expect(yield* kept()).toEqual({ owners: {} });
      expect(yield* refusal(secrets.set(projectId, target, TOKEN))).toBe('secret-owner-unknown');
    }),
);

it.live('an app whose secret store cannot be read does not start, and the failure does not quote the store', () =>
  Effect.gen(function* () {
    const { plugins, projectId, file } = yield* setup((home) =>
      writeFile(join(home, 'secrets.json'), '{"owners": {"plugins": {"fixture": {"values": {"API_TOKEN": 7}}}}}  garbage-token-5521'),
    );
    const row = yield* plugins.install({ projectId, id: 'fixture', enabled: true });
    expect(row.state).toBe('failed');
    expect(row.failure ?? '').toContain('secret store');
    expect(JSON.stringify(row)).not.toContain('garbage-token-5521');
    expect(yield* file('plugin-data/fixture/journal')).toBe(false);
  }),
);
