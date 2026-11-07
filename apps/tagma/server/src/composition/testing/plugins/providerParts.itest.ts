import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer, Queue, Schedule, Stream } from 'effect';
import { MANIFEST } from '../../../plugin-formats/tagma/contract/wire/manifest.js';
import { manifestText, PROVIDERS_ENTRY } from '../../../plugin-formats/tagma/testing/folder.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { HostedPlugins, PluginRevisions, Plugins, ProviderParts } from '../../../plugins/contract/service/plugins.js';
import { PLUGIN_OPERATIONS } from '../../../plugins/contract/wire/operations.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { makeDoorWorld } from '../doorFixture.js';
import { settledThread } from '../native-harness/settled.fixture.js';

type Answer = { readonly status: number; readonly body: unknown };
type Row = {
  readonly id: string;
  readonly builtin: boolean;
  readonly faults: readonly { readonly point: string; readonly detail: string }[];
};

const noInstall = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.sync(() => {
      const kept = [...process.execArgv];
      if (!process.execArgv.includes('--no-install')) process.execArgv.push('--no-install');
      return kept;
    }),
    (kept) => Effect.sync(() => void process.execArgv.splice(0, process.execArgv.length, ...kept)),
  ),
);

const wire = (id: string, baseURL = 'https://unused.invalid/v1') => `
import { Effect } from 'effect';
import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { consoleKey } from '@runlith/llm/profiles/credential';
import { route } from '@runlith/llm/protocols/openai-compatible-chat';
import { QuotaUnsupported } from '@runlith/llm/schema/quota';
export default {
  models: defineAdapter(() => [
    {
      id: '${id}',
      label: '${id}',
      kind: 'wire',
      auth: 'api-key',
      models: { '${id}-1': { label: 'One', capacity: { context: 100000, output: 1024 }, capabilities: ['text'], reasoning: [], defaultReasoning: null } },
      cacheLifetime: { promisedSeconds: null, prior: null },
      defaultTextModel: '${id}-1',
      profile: {
        model: (selection) =>
          Effect.succeed(
            route
              .with({
                provider: '${id}',
                endpoint: { baseURL: '${baseURL}' },
                auth: consoleKey(selection.credentials, selection.ownerId, '${id}', selection.account).bearer(),
                limits: { output: 1024 },
              })
              .model({ id: selection.model }),
          ),
        options: () => undefined,
        output: { budget: 1024, sent: true },
      },
      quota: { read: () => Effect.fail(new QuotaUnsupported()), fromHeaders: () => null },
    },
  ]),
};
`;

const REPLY = [
  { id: 'reply', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello from the stub.' }, finish_reason: null }] },
  { id: 'reply', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
]
  .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
  .join('');

const part = Effect.fnUntraced(function* (directory: string, id: string, code: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(join(directory, 'dist'), { recursive: true });
  yield* files.writeFileString(
    join(directory, MANIFEST),
    manifestText({ id, providers: { models: true, harnesses: false, speech: false } }),
  );
  yield* files.writeFileString(join(directory, PROVIDERS_ENTRY), code);
  return directory;
});

const makeWorld = Effect.gen(function* () {
  const door = yield* makeDoorWorld({ own: 'installs provider plugins and turns plugins off on the machine' });
  const files = yield* FileSystem.FileSystem;
  const projectId = yield* door.stealthProject();
  const project = `project=${projectId}`;
  return {
    op: (id: string, input: unknown): Effect.Effect<Answer> => door.op(id, input, project),
    root: yield* files.makeTempDirectoryScoped({ prefix: 'provider-parts-' }),
    projectId,
    registry: Context.get(door.runtime.owners, ProviderRegistry),
    plugins: yield* Effect.orDie(Effect.fromOption(Context.getOption(door.runtime.owners, Plugins))),
    parts: yield* Effect.orDie(Effect.fromOption(Context.getOption(door.runtime.owners, ProviderParts))),
    hosted: yield* Effect.orDie(Effect.fromOption(Context.getOption(door.runtime.owners, HostedPlugins))),
    revisions: Context.get(door.runtime.owners, PluginRevisions),
    settled: (threadId: string) => settledThread({ threadId, projectId }).pipe(Effect.provide(door.runtime.owners)),
  };
});

class World extends Context.Service<World, Effect.Success<typeof makeWorld>>()('testing/ProviderPartsWorld') {}

const world = Layer.effect(World, makeWorld);

const rows = Effect.fnUntraced(function* () {
  const { op } = yield* World;
  const found: Row[] = [];
  let cursor: string | null | undefined;
  do {
    const read = yield* op('read_plugins', cursor === undefined ? { limit: 8 } : { limit: 8, cursor });
    const body = read.body as { readonly plugins: readonly Row[]; readonly next: string | null };
    found.push(...body.plugins);
    cursor = body.next;
  } while (cursor !== null);
  return found;
});

const menu = Effect.fnUntraced(function* () {
  const { op } = yield* World;
  return ((yield* op('read_model_menu', {})).body as { readonly providers: readonly { readonly id: string }[] }).providers.map(
    ({ id }) => id,
  );
});

const until = <A>(read: Effect.Effect<A, never, World>, done: (value: A) => boolean) =>
  Effect.repeat(read, { until: done, schedule: Schedule.spaced('20 millis'), times: 500 });

const packaged = (provider: string, other?: string) =>
  Effect.flatMap(World, ({ registry }) =>
    until(
      Effect.sync(() => registry.current().packages.get(provider)),
      (directory) => directory !== undefined && directory !== other,
    ),
  );

const partOf = (id: string, other?: string) =>
  Effect.flatMap(World, ({ parts }) =>
    until(
      Effect.sync(() => parts.current().find((held) => held.id === id)?.directory ?? undefined),
      (directory) => directory !== undefined && directory !== other,
    ),
  );

layer(world.pipe(Layer.provideMerge(noInstall), Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'provider parts',
  (it) => {
    it.effect(
      'a built-in plugin stands in read_plugins, refuses uninstalling, and turned off on the machine leaves the menu until on again',
      () =>
        Effect.gen(function* () {
          const { op, registry } = yield* World;
          expect((yield* rows()).find((row) => row.id === 'anthropic')).toMatchObject({
            builtin: true,
            source: null,
            root: null,
            off: false,
            providers: { models: true, harnesses: true, speech: false },
          });
          expect(yield* op('uninstall_plugin', { id: 'anthropic' })).toMatchObject({ status: 409, body: { code: 'plugin-builtin' } });
          expect(yield* op('enable_plugin', { id: 'anthropic', enabled: false })).toMatchObject({
            status: 409,
            body: { code: 'plugin-builtin' },
          });
          const shipped = registry.current().adapters.find((adapter) => adapter.id === 'anthropic');
          const ids = shipped?.state === 'loaded' ? shipped.providers : [];
          expect(ids.length).toBeGreaterThan(0);

          expect(yield* op('enable_plugin', { id: 'anthropic', enabled: false, scope: 'machine' })).toMatchObject({
            status: 200,
            body: { plugin: { id: 'anthropic', off: true } },
          });
          expect(yield* until(menu(), (listed) => !ids.some((id) => listed.includes(id)))).not.toEqual(expect.arrayContaining(ids));
          expect(yield* op('enable_plugin', { id: 'anthropic', enabled: true, scope: 'machine' })).toMatchObject({ status: 200 });
          expect(yield* until(menu(), (listed) => ids.every((id) => listed.includes(id)))).toEqual(expect.arrayContaining(ids));
        }),
    );

    it.effect(
      'a provider plugin from a folder serves its model at once; a part that throws and a part repeating its provider read broken',
      () =>
        Effect.gen(function* () {
          const { op, root } = yield* World;
          const acme = yield* part(join(root, 'acme'), 'acme-plugin', wire('acme'));
          expect(yield* op('install_plugin', { source: acme })).toMatchObject({
            status: 200,
            body: { plugin: { providers: { models: true } } },
          });
          expect(yield* until(menu(), (listed) => listed.includes('acme'))).toContain('acme');

          const broken = yield* part(join(root, 'broken'), 'broken-part', "throw new Error('the part is broken');\n");
          expect(yield* op('install_plugin', { source: broken })).toMatchObject({ status: 200 });
          const twin = yield* part(join(root, 'twin'), 'twin-part', wire('acme'));
          expect(yield* op('install_plugin', { source: twin })).toMatchObject({ status: 200 });
          const faulted = yield* until(rows(), (listed) =>
            ['broken-part', 'twin-part'].every((id) =>
              listed.find((row) => row.id === id)?.faults.some((fault) => fault.point === 'providers'),
            ),
          );
          expect(faulted.find((row) => row.id === 'broken-part')?.faults).toEqual([
            expect.objectContaining({ point: 'providers', detail: expect.stringContaining('the part is broken') }),
          ]);
          expect(faulted.find((row) => row.id === 'twin-part')?.faults).toEqual([
            expect.objectContaining({ point: 'providers', detail: expect.stringContaining('acme-plugin') }),
          ]);
          expect(yield* menu()).toContain('acme');

          for (const id of ['acme-plugin', 'broken-part', 'twin-part'])
            expect(yield* op('uninstall_plugin', { id })).toMatchObject({ status: 200 });
          expect(yield* until(menu(), (listed) => !listed.includes('acme'))).not.toContain('acme');
        }),
    );

    it.effect('a thread runs a turn on the model a provider plugin from a folder brings, through that plugin’s own wire', () =>
      Effect.gen(function* () {
        const { op, root, settled } = yield* World;
        const asked: { readonly authorization: string | null; readonly model: unknown }[] = [];
        const stub = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              hostname: '127.0.0.1',
              port: 0,
              fetch: async (request) => {
                if (new URL(request.url).pathname !== '/v1/chat/completions') return new Response('absent', { status: 404 });
                const body = (await request.json()) as { readonly model?: unknown };
                asked.push({ authorization: request.headers.get('authorization'), model: body.model });
                return new Response(`${REPLY}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
              },
            }),
          ),
          (served) => Effect.promise(() => served.stop(true)),
        );
        const relay = yield* part(join(root, 'relay'), 'relay-plugin', wire('relay', `http://127.0.0.1:${stub.port}/v1`));
        expect(yield* op('install_plugin', { source: relay })).toMatchObject({ status: 200 });
        expect(yield* until(menu(), (listed) => listed.includes('relay'))).toContain('relay');
        expect(yield* op('save_console_key', { provider: 'relay', key: 'relay-key' })).toMatchObject({ status: 200 });

        const created = yield* op('create_thread', { type: 'tagma' });
        const threadId = (created.body as { readonly snapshot: { readonly thread: { readonly id: string } } }).snapshot.thread.id;
        expect(
          yield* op('set_thread_model', { threadId, provider: 'relay', model: 'relay-1', reasoning: null, switches: {} }),
        ).toMatchObject({
          status: 200,
        });
        expect(yield* op('start_turn', { threadId, text: 'Say hello.', key: crypto.randomUUID() })).toMatchObject({ status: 200 });
        expect((yield* settled(threadId)).latestRun).toMatchObject({ status: 'completed' });
        expect(asked).toContainEqual({ authorization: 'Bearer relay-key', model: 'relay-1' });

        expect(yield* op('uninstall_plugin', { id: 'relay-plugin' })).toMatchObject({ status: 200 });
      }).pipe(Effect.scoped),
    );

    it.effect('installing a provider plugin that runs in no project asks consent for its provider part, which joins the menu', () =>
      Effect.gen(function* () {
        const { op, root, projectId, plugins } = yield* World;
        const quiet = yield* part(join(root, 'quiet'), 'quiet-plugin', wire('quiet'));
        const input = { source: quiet, enabled: false };
        const prepared = yield* plugins.prepare({ projectId, source: quiet });
        expect(PLUGIN_OPERATIONS.install_plugin.subjects(input, prepared)).toEqual([
          { kind: 'execute', value: expect.stringMatching(/quiet\/dist\/providers\.js$/u) },
        ]);
        expect(yield* op('install_plugin', input)).toMatchObject({ status: 200 });
        expect(yield* until(menu(), (listed) => listed.includes('quiet'))).toContain('quiet');
        expect(yield* op('uninstall_plugin', { id: 'quiet-plugin' })).toMatchObject({ status: 200 });
      }),
    );

    it.effect('turning a built-in plugin on again takes its provider id back from a later plugin, which reads broken naming it', () =>
      Effect.gen(function* () {
        const { op, root, registry } = yield* World;
        const owner = () => Effect.sync(() => registry.current().served.providers.find((provider) => provider.id === 'anthropic')?.plugin);
        expect(yield* op('enable_plugin', { id: 'anthropic', enabled: false, scope: 'machine' })).toMatchObject({ status: 200 });
        const impostor = yield* part(join(root, 'impostor'), 'impostor-plugin', wire('anthropic'));
        expect(yield* op('install_plugin', { source: impostor })).toMatchObject({ status: 200 });
        expect(yield* until(owner(), (plugin) => plugin === 'impostor-plugin')).toBe('impostor-plugin');

        expect(yield* op('enable_plugin', { id: 'anthropic', enabled: true, scope: 'machine' })).toMatchObject({ status: 200 });
        expect(yield* until(owner(), (plugin) => plugin === 'anthropic')).toBe('anthropic');
        const faulted = yield* until(rows(), (listed) =>
          listed.some((row) => row.id === 'impostor-plugin' && row.faults.some((fault) => fault.point === 'providers')),
        );
        expect(faulted.find((row) => row.id === 'impostor-plugin')?.faults).toEqual([
          expect.objectContaining({ point: 'providers', detail: expect.stringContaining('anthropic') }),
        ]);
        expect(faulted.find((row) => row.id === 'anthropic')?.faults).toEqual([]);
        expect(yield* op('uninstall_plugin', { id: 'impostor-plugin' })).toMatchObject({ status: 200 });
      }),
    );

    it.effect('a folder plugin installed without providers serves them once a rebuild in place adds its provider part', () =>
      Effect.gen(function* () {
        const { op, root } = yield* World;
        const files = yield* FileSystem.FileSystem;
        const late = join(root, 'late');
        yield* files.makeDirectory(join(late, 'dist'), { recursive: true });
        yield* files.writeFileString(join(late, MANIFEST), manifestText({ id: 'late-plugin' }));
        expect(yield* op('install_plugin', { source: late })).toMatchObject({ status: 200 });
        yield* part(late, 'late-plugin', wire('late'));
        expect(yield* until(menu(), (listed) => listed.includes('late'))).toContain('late');
        expect(yield* op('uninstall_plugin', { id: 'late-plugin' })).toMatchObject({ status: 200 });
      }),
    );

    it.effect('a revision whose removal fails waits for a later collection, and the builds after it still reach the catalog', () =>
      Effect.gen(function* () {
        const { op, root } = yield* World;
        const files = yield* FileSystem.FileSystem;
        const stuck = yield* part(join(root, 'stuck'), 'stuck-plugin', wire('stuck'));
        expect(yield* op('install_plugin', { source: stuck })).toMatchObject({ status: 200 });
        const first = (yield* packaged('stuck'))!;
        const base = join(first, '..', '..');
        yield* Effect.acquireRelease(files.chmod(join(first, 'dist'), 0o555), () =>
          Effect.gen(function* () {
            const retired = (yield* files.readDirectory(base)).filter((name) => name.startsWith('.retired-'));
            for (const directory of [join(first, 'dist'), ...retired.map((name) => join(base, name, 'dist'))])
              if (yield* files.exists(directory)) yield* files.chmod(directory, 0o755);
          }).pipe(Effect.orDie),
        );
        yield* part(stuck, 'stuck-plugin', `${wire('stuck')}// second\n`);
        const second = (yield* packaged('stuck', first))!;
        yield* part(stuck, 'stuck-plugin', `${wire('stuck')}// third\n`);
        expect(yield* packaged('stuck', second)).not.toBe(second);
        expect(yield* op('uninstall_plugin', { id: 'stuck-plugin' })).toMatchObject({ status: 200 });
      }).pipe(Effect.scoped),
    );

    it.effect(
      'a revision the registry is still loading outlives a newer build and a collection, and goes once the registry moves past it',
      () =>
        Effect.gen(function* () {
          const { op, root, registry, revisions } = yield* World;
          const files = yield* FileSystem.FileSystem;
          const gate = globalThis as { __providerPartsGate?: () => void };
          const open = Effect.sync(() => {
            gate.__providerPartsGate?.();
            delete gate.__providerPartsGate;
          });
          yield* Effect.addFinalizer(() => open);
          const slow = yield* part(join(root, 'slow'), 'slow-plugin', wire('slow'));
          expect(yield* op('install_plugin', { source: slow })).toMatchObject({ status: 200 });
          const first = (yield* packaged('slow'))!;
          yield* part(slow, 'slow-plugin', `${wire('slow')}await new Promise((open) => { globalThis.__providerPartsGate = open; });\n`);
          const loading = (yield* partOf('slow-plugin', first))!;
          yield* until(
            Effect.sync(() => gate.__providerPartsGate),
            (open) => open !== undefined,
          );
          yield* part(slow, 'slow-plugin', `${wire('slow')}// newer\n`);
          const newer = (yield* partOf('slow-plugin', loading))!;
          yield* revisions.released;
          expect(yield* files.exists(loading)).toBe(true);

          yield* open;
          expect(
            yield* until(
              Effect.sync(() => registry.current().packages.get('slow')),
              (directory) => directory === newer,
            ),
          ).toBe(newer);
          expect(yield* until(files.exists(loading).pipe(Effect.orDie), (standing) => !standing)).toBe(false);
          expect(yield* op('uninstall_plugin', { id: 'slow-plugin' })).toMatchObject({ status: 200 });
        }).pipe(Effect.scoped),
    );

    it.effect('a revision carries the provider part’s own files, so rebuilding only the process and the views mints none', () =>
      Effect.gen(function* () {
        const { op, root, parts, hosted } = yield* World;
        const files = yield* FileSystem.FileSystem;
        const folder = join(root, 'mixed');
        const built = Effect.fnUntraced(function* (hash: string, process: string, view: string) {
          yield* files.makeDirectory(join(folder, 'dist/ui'), { recursive: true });
          yield* files.writeFileString(join(folder, 'dist/process.js'), process);
          yield* files.writeFileString(join(folder, 'dist/ui/graph.json'), view);
          yield* files.writeFileString(
            join(folder, MANIFEST),
            manifestText({
              id: 'mixed-plugin',
              program: 'unused',
              providers: { models: true, harnesses: false, speech: false },
              build: { hash: hash.repeat(64), sources: [] },
            }),
          );
        });
        yield* built('a', '// one\n', '{}');
        yield* files.writeFileString(join(folder, 'dist/ask.sh'), 'echo asked\n');
        yield* files.writeFileString(join(folder, PROVIDERS_ENTRY), wire('mixed'));
        const seen = yield* Queue.unbounded<string>();
        yield* Effect.forkScoped(
          Stream.runForEach(parts.changes, (standing) => {
            const directory = standing.find((part) => part.id === 'mixed-plugin')?.directory;
            return directory == null ? Effect.void : Queue.offer(seen, directory);
          }),
        );
        const heard = yield* Queue.unbounded<string>();
        yield* Effect.forkScoped(Stream.runForEach(hosted.changes, (id) => Queue.offer(heard, id)));
        expect(yield* op('install_plugin', { source: folder })).toMatchObject({ status: 200 });
        const first = (yield* partOf('mixed-plugin'))!;
        const copied = yield* files.readDirectory(first, { recursive: true });
        expect(copied.filter((name) => name.includes('.')).sort()).toEqual(['dist/ask.sh', 'dist/providers.js', MANIFEST]);

        yield* built('b', '// two\n', '{"rebuilt":true}');
        yield* Effect.repeat(Queue.take(heard), { until: (id) => id === 'mixed-plugin' });
        yield* files.writeFileString(join(folder, PROVIDERS_ENTRY), `${wire('mixed')}// rebuilt\n`);
        const second = (yield* partOf('mixed-plugin', first))!;
        const distinct = [...new Set(yield* Queue.takeAll(seen))];
        expect(distinct).toEqual([first, second]);
        expect(yield* op('uninstall_plugin', { id: 'mixed-plugin' })).toMatchObject({ status: 200 });
      }).pipe(Effect.scoped),
    );

    it.effect('an npm package installs by its name from the registry the machine’s npm configuration names', () =>
      Effect.gen(function* () {
        const { op, root } = yield* World;
        const files = yield* FileSystem.FileSystem;
        const staged = join(root, 'npm-stage');
        yield* part(join(staged, 'package'), 'npm-acme', wire('npmacme'));
        const archive = join(root, 'npm-acme-1.0.0.tgz');
        expect((yield* spawnedEffect(['tar', '-czf', archive, '-C', staged, 'package'])).exitCode).toBe(0);
        const bytes = yield* files.readFile(archive);
        const server = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              port: 0,
              fetch: (request) => {
                const path = new URL(request.url).pathname;
                if (path === '/npm-acme')
                  return Response.json({
                    name: 'npm-acme',
                    'dist-tags': { latest: '1.0.0' },
                    versions: {
                      '1.0.0': {
                        name: 'npm-acme',
                        version: '1.0.0',
                        dist: { tarball: new URL('/npm-acme-1.0.0.tgz', request.url).href },
                      },
                    },
                  });
                return path === '/npm-acme-1.0.0.tgz' ? new Response(bytes) : new Response('absent', { status: 404 });
              },
            }),
          ),
          (served) => Effect.promise(() => served.stop(true)),
        );
        const variables = { npm_config_registry: `http://127.0.0.1:${server.port}`, BUN_INSTALL_CACHE_DIR: join(root, 'npm-cache') };
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const kept = Object.fromEntries(Object.keys(variables).map((name) => [name, process.env[name]]));
            Object.assign(process.env, variables);
            return kept;
          }),
          (kept) =>
            Effect.sync(() => {
              for (const [name, value] of Object.entries(kept)) {
                if (value === undefined) delete process.env[name];
                else process.env[name] = value;
              }
            }),
        );
        expect(yield* op('install_plugin', { source: 'npm:npm-acme' })).toMatchObject({
          status: 200,
          body: { plugin: { id: 'npm-acme', source: { kind: 'npm', name: 'npm-acme' } } },
        });
        expect(yield* until(menu(), (listed) => listed.includes('npmacme'))).toContain('npmacme');
        expect(yield* op('uninstall_plugin', { id: 'npm-acme' })).toMatchObject({ status: 200 });
      }).pipe(Effect.scoped),
    );
  },
);
