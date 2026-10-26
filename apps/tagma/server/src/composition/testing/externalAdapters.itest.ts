import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { createAdapter } from '@runlith/tagma/adapter/create';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { spawnedEffect } from '../../platform/testing/spawn.js';

const PROBE = join(import.meta.dir, 'adapterProbe.ts');

const adapterText = (label: string) => `
import { Effect } from 'effect';
import { LLMError, ProviderInternalReason } from '@runlith/llm/schema/errors';
import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { inner } from './inner.ts';

export const adapter = defineAdapter(() => [
  {
    id: 'acme',
    label: ${JSON.stringify(label)},
    kind: 'wire',
    auth: 'api-key',
    inner,
    models: {
      'acme-1': { label: 'Acme 1', capacity: { context: 100000 }, capabilities: ['text'], reasoning: [], defaultReasoning: null },
    },
    cacheLifetime: { promisedSeconds: null, prior: null },
    defaultTextModel: 'acme-1',
    profile: { model: () => Effect.die('unused'), options: () => undefined, output: { kind: 'none' } },
    quota: {
      read: () => Effect.fail(new LLMError({ module: 'acme', method: 'quota', reason: new ProviderInternalReason({ message: 'down' }) })),
      fromHeaders: () => null,
    },
  },
]);
`;

class Adapters extends Context.Service<Adapters, { readonly root: string }>()('testing/ExternalAdapters') {}

const adapterPackage = Effect.fnUntraced(function* (name: string, version: string, label: string, inner: string, extra = '') {
  const { root } = yield* Adapters;
  const files = yield* FileSystem.FileSystem;
  const at = join(root, name);
  yield* files.makeDirectory(at, { recursive: true });
  const manifest = { name: 'acme-adapter', version, exports: { '.': './adapter.ts' } };
  yield* files.writeFileString(join(at, 'package.json'), JSON.stringify(manifest));
  yield* files.writeFileString(join(at, 'adapter.ts'), `${extra}${adapterText(label)}`);
  yield* files.writeFileString(join(at, 'inner.ts'), `export const inner = ${JSON.stringify(inner)};\n`);
  return at;
});

const probe = Effect.fnUntraced(function* (flags: readonly string[], machine: string, sources: readonly string[]) {
  const ran = yield* spawnedEffect([process.execPath, ...flags, PROBE, machine, ...sources]);
  if (ran.exitCode !== 0) return yield* Effect.die(new Error(`the probe exited ${ran.exitCode}: ${ran.stderr.toString()}`));
  return JSON.parse(ran.stdout.toString().trim().split('\n').at(-1) as string);
});

const entries = Effect.fnUntraced(function* (machine: string) {
  const files = yield* FileSystem.FileSystem;
  return yield* files.readDirectory(machine);
});

const rooted = Layer.effect(
  Adapters,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    return { root: yield* files.makeTempDirectoryScoped({ prefix: 'tagma-adapters-' }) };
  }),
);

layer(rooted.pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('external adapters', (it) => {
  it.effect('a created adapter passes the author kit and serves a model call through the real external loader', () =>
    Effect.gen(function* () {
      const { root } = yield* Adapters;
      const directory = join(root, 'created');
      yield* Effect.promise(() => createAdapter(directory, 'acme'));
      const [loaded] = yield* probe(['--no-install'], join(root, 'created-machine'), [`template:${directory}`]);
      expect(loaded).toMatchObject({
        state: { state: 'loaded', providers: ['acme'] },
        model: { text: 'hello', sameClass: true },
        contract: { provider: 'acme', model: 'acme-1', text: 'hello', sameClass: true, image: 'image/png' },
      });
    }),
  );

  it.effect(
    'an adapter installed from a directory loads through the host modules, a new version serves the next run without a restart, and an import outside the host modules fails its load',
    () =>
      Effect.gen(function* () {
        const { root } = yield* Adapters;
        const first = yield* adapterPackage('v1', '1.0.0', 'Acme one', 'first');
        const second = yield* adapterPackage('v2', '2.0.0', 'Acme two', 'second');
        const foreign = yield* adapterPackage('v3', '3.0.0', 'Acme three', 'third', "import 'left-pad-never-installed';\n");
        const machine = join(root, 'machine');

        const [installed, updated, broken] = yield* probe(['--no-install'], machine, [first, second, foreign]);

        expect(installed).toMatchObject({
          state: { id: 'acme-adapter', origin: 'machine', version: '1.0.0', state: 'loaded', providers: ['acme'] },
          label: 'Acme one',
          inner: 'first',
          refusal: { sameClass: true },
        });
        expect(updated).toMatchObject({
          state: { version: '2.0.0', state: 'loaded' },
          label: 'Acme two',
          inner: 'second',
          pinned: 'Acme one',
        });
        expect(broken.state).toMatchObject({ version: '3.0.0', state: 'failed' });
        expect(broken.state.reason).toContain('left-pad-never-installed');
        expect((yield* entries(machine)).filter((name) => !name.endsWith('.json')).sort()).toEqual([
          'acme-adapter@1.0.0',
          'acme-adapter@2.0.0',
          'acme-adapter@3.0.0',
        ]);

        yield* probe(['--no-install'], machine, []);
        expect((yield* entries(machine)).filter((name) => !name.endsWith('.json'))).toEqual(['acme-adapter@3.0.0']);
      }),
  );

  it.effect('an update installs again from the recorded source, and a removed adapter stops serving and leaves no folder', () =>
    Effect.gen(function* () {
      const { root } = yield* Adapters;
      const at = yield* adapterPackage('kept', '1.0.0', 'Acme kept', 'kept');
      const machine = join(root, 'kept-machine');

      const [, updated, removed] = yield* probe(['--no-install'], machine, [at, 'update:acme-adapter', 'remove:acme-adapter']);

      expect(updated).toMatchObject({ state: { state: 'loaded', version: '1.0.0' }, label: 'Acme kept' });
      expect(removed).toMatchObject({ state: { removed: 'acme-adapter' }, label: null });
      expect(yield* entries(machine)).toEqual(['installed.json']);
    }),
  );

  it.effect('a disabled adapter is not loaded and its provider is gone until it is enabled again', () =>
    Effect.gen(function* () {
      const { root } = yield* Adapters;
      const at = yield* adapterPackage('switched', '1.0.0', 'Acme switched', 'switched');
      const machine = join(root, 'switched-machine');

      const [installed, disabled, enabled] = yield* probe(['--no-install'], machine, [at, 'disable:acme-adapter', 'enable:acme-adapter']);

      expect(installed).toMatchObject({ state: { state: 'loaded', source: at }, label: 'Acme switched' });
      expect(disabled).toMatchObject({ state: { state: 'disabled', id: 'acme-adapter', version: '1.0.0', source: at }, label: null });
      expect(enabled).toMatchObject({ state: { state: 'loaded' }, label: 'Acme switched' });
    }),
  );

  it.effect('a server started without --no-install refuses to load an external adapter', () =>
    Effect.gen(function* () {
      const { root } = yield* Adapters;
      const at = yield* adapterPackage('plain', '1.0.0', 'Acme plain', 'plain');
      const [installed] = yield* probe([], join(root, 'plain-machine'), [at]);

      expect(installed.state).toMatchObject({ state: 'failed' });
      expect(installed.state.reason).toContain('--no-install');
    }),
  );
});
