import { join } from 'node:path';
import { Context, Effect, FileSystem, Schedule } from 'effect';
import { MANIFEST } from '../../../plugin-formats/tagma/contract/wire/manifest.js';
import { manifestText, PROVIDERS_ENTRY } from '../../../plugin-formats/tagma/testing/folder.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { Blocks } from '../../../graph/contract/service/blocks.js';
import { HarnessAdapters } from '../../../external-harnesses/contract/service/adapters.js';
import { harnessPresentation } from '../../../external-harnesses/contract/service/table.js';
import { terminalTestKernel } from '../../../external-harnesses/testing/seats.js';
import { unmeasuredObservation } from '../../../threads/contract/wire/harness/observation.js';
import { sessionTokenEnvironment } from '../../../platform/testing/grants.js';
import { sessionIdentity } from '../../../external-harnesses/testing/builtin.js';
import { hookThreads, HOOK_SESSION } from '../hookFixture.js';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { GRANT_VARIABLE, SESSION_TOKEN_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { MCP_KEY_VARIABLE } from '../../../platform/contract/wire/session.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { QUILL, quillPackage } from '../external-harnesses/quill.js';
import { makeTerminalWorld } from '../fixture.js';

const program = Effect.gen(function* () {
  const world = yield* makeTerminalWorld({ own: 'install a provider plugin and launch its hook process' });
  const project = yield* world.checkout();
  const root = yield* world.directory('quill');
  const files = yield* FileSystem.FileSystem;
  const path = join(project.root, 'quill.txt');
  yield* files.writeFileString(path, 'quill data\n');
  const blocks = Context.get(world.runtime.graph, Blocks);
  yield* Effect.provide(
    Effect.gen(function* () {
      const parentId = (yield* blocks.rootBlockOf(project.id)).id;
      yield* blocks.create({
        projectId: project.id,
        parentId,
        tags: ['explanation'],
        title: 'Quill data',
        body: 'The record stores one value per line.',
        sources: [{ kind: 'file', ref: 'quill.txt' }],
      });
    }),
    world.runtime.owners,
  );
  const broken = join(root, 'broken');
  yield* files.makeDirectory(join(broken, 'dist'), { recursive: true });
  yield* files.writeFileString(
    join(broken, MANIFEST),
    manifestText({ id: 'broken-plugin', providers: { models: true, harnesses: false, speech: false } }),
  );
  yield* files.writeFileString(join(broken, PROVIDERS_ENTRY), "throw new Error('unrelated plugin is broken');\n");
  const install = (source: string) =>
    world.tagma(['op', 'install_plugin', '--yes', JSON.stringify({ project: project.id, source, enabled: false }), '--json']);
  const unrelated = yield* install(broken);
  const quill = yield* quillPackage(root);
  const installed = yield* install(quill.directory);
  const registry = Context.get(world.runtime.owners, ProviderRegistry);
  yield* Effect.repeat(
    Effect.sync(() => registry.current().packages.get(QUILL.harness)),
    { until: (directory) => directory !== undefined, schedule: Schedule.spaced('20 millis'), times: 500 },
  );
  const failed = registry.current().adapters.find((adapter) => adapter.id === 'broken-plugin');
  const data = yield* world.directory('home');
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
  delete env[GRANT_VARIABLE];
  delete env[SESSION_TOKEN_VARIABLE];
  const hook = (harness: string | null, grant: Record<string, string | undefined> = {}) =>
    spawnedEffect(
      [
        process.execPath,
        '--no-install',
        join(import.meta.dir, '../../developer/cli.ts'),
        'hook',
        'session-start',
        ...(harness === null ? [] : ['--harness', harness]),
      ],
      {
        cwd: project.root,
        env: { ...env, TAGMA_SERVER_URL: world.url, TAGMA_DATABASE_PATH: join(data, 'tagma.sqlite'), ...grant },
        stdin: new Blob([JSON.stringify({ hook_event_name: 'quill.open', quill_session: 'quill-root', cwd: project.root })]),
      },
    );
  const row = yield* Context.get(world.runtime.owners, HarnessAdapters).row(QUILL.harness);
  const thread = yield* hookThreads(world).bornThread(
    crypto.randomUUID(),
    project.id,
    {
      name: QUILL.harness,
      presentation: harnessPresentation(row),
      sessionKey: 'quill-root',
      execution: null,
      observation: unmeasuredObservation(),
      session: {
        id: HOOK_SESSION,
        origin: 'launched',
        state: 'running',
        prompt: '',
        cwd: null,
        argv: [QUILL.binary],
        ownerId: null,
        startedAt: '2026-10-30T12:00:00.000Z',
        heartbeatAt: '2026-10-30T12:00:00.000Z',
      },
    },
    terminalTestKernel(row),
  );
  const answered = yield* hook(QUILL.harness);
  const read = yield* spawnedEffect(
    [
      process.execPath,
      '--no-install',
      join(import.meta.dir, '../../developer/cli.ts'),
      'hook',
      'post-tool-use',
      '--harness',
      QUILL.harness,
    ],
    {
      cwd: project.root,
      env: {
        ...env,
        TAGMA_SERVER_URL: world.url,
        TAGMA_DATABASE_PATH: join(data, 'tagma.sqlite'),
        ...sessionTokenEnvironment(thread, HOOK_SESSION, sessionIdentity),
      },
      stdin: new Blob([
        JSON.stringify({
          hook_event_name: 'quill.after',
          quill_session: 'quill-root',
          quill_tool: 'look',
          quill_file: path,
          cwd: project.root,
        }),
      ]),
    },
  );
  const unnamed = yield* hook(null, sessionTokenEnvironment(thread, HOOK_SESSION, sessionIdentity));
  const unknown = yield* hook('constructor');
  const mcp = yield* spawnedEffect(
    [process.execPath, '--no-install', join(import.meta.dir, '../../developer/cli.ts'), 'mcp-serve', '--harness', QUILL.harness],
    {
      cwd: project.root,
      env: { ...env, TAGMA_SERVER_URL: world.url, TAGMA_DATABASE_PATH: join(data, 'tagma.sqlite'), [MCP_KEY_VARIABLE]: undefined },
    },
  );
  const removed = yield* world.tagma([
    'op',
    'uninstall_plugin',
    '--yes',
    JSON.stringify({ project: project.id, id: QUILL.name }),
    '--json',
  ]);
  yield* Effect.repeat(
    Effect.sync(() => registry.current().packages.get(QUILL.harness)),
    { until: (directory) => directory === undefined, schedule: Schedule.spaced('20 millis'), times: 500 },
  );
  const missing = yield* hook(QUILL.harness);
  return {
    unrelated,
    installed,
    failed,
    removed,
    missing: { code: missing.exitCode, err: missing.stderr.toString() },
    mcp: { code: mcp.exitCode, err: mcp.stderr.toString() },
    answered: { code: answered.exitCode, out: answered.stdout.toString(), err: answered.stderr.toString() },
    read: { code: read.exitCode, out: read.stdout.toString(), err: read.stderr.toString() },
    unnamed: { code: unnamed.exitCode, out: unnamed.stdout.toString(), err: unnamed.stderr.toString() },
    unknown: { code: unknown.exitCode, err: unknown.stderr.toString() },
  };
}).pipe(Effect.provide(BunFileSystem.layer), Effect.scoped);

BunRuntime.runMain(Effect.tap(program, (result) => Effect.sync(() => console.log(`installed-hook ${JSON.stringify(result)}`))));
