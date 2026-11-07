import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer, Schedule } from 'effect';
import { MANIFEST } from '../../../plugin-formats/tagma/contract/wire/manifest.js';
import { manifestText, PROVIDERS_ENTRY } from '../../../plugin-formats/tagma/testing/folder.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
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
    registry: Context.get(door.runtime.owners, ProviderRegistry),
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
                    'dist-tags': { latest: '1.0.0' },
                    versions: { '1.0.0': { dist: { tarball: new URL('/npm-acme-1.0.0.tgz', request.url).href } } },
                  });
                return path === '/npm-acme-1.0.0.tgz' ? new Response(bytes) : new Response('absent', { status: 404 });
              },
            }),
          ),
          (served) => Effect.promise(() => served.stop(true)),
        );
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const kept = process.env.npm_config_registry;
            process.env.npm_config_registry = `http://127.0.0.1:${server.port}`;
            return kept;
          }),
          (kept) =>
            Effect.sync(() => {
              if (kept === undefined) delete process.env.npm_config_registry;
              else process.env.npm_config_registry = kept;
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
