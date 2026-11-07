import { expect } from 'bun:test';
import { delimiter, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Fiber, FileSystem, Layer, Predicate, Schedule } from 'effect';
import { PluginRevisions } from '../../../plugins/contract/service/plugins.js';
import { ModelAsks } from '../../../providers/contract/service/asks.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { SessionRead } from '../../../threads/contract/service/harness.js';
import { makeDoorWorld } from '../doorFixture.js';
import { QUILL, quillPackage, quillRelease } from './quill.js';

type Answer = { readonly status: number; readonly body: unknown };

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

const onPath = (bin: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const kept = process.env.PATH;
      process.env.PATH = [bin, kept].filter((part) => part !== undefined).join(delimiter);
      return kept;
    }),
    (kept) =>
      Effect.sync(() => {
        process.env.PATH = kept;
      }),
  );

class World extends Context.Service<
  World,
  {
    readonly op: (id: string, input: unknown, query?: string) => Effect.Effect<Answer>;
    readonly source: string;
    readonly bin: string;
    readonly root: string;
    readonly launched: string;
    readonly projectId: number;
    readonly sessions: SessionRead['Service'];
    readonly asks: ModelAsks['Service'];
    readonly registry: ProviderRegistry['Service'];
    readonly revisions: PluginRevisions['Service'];
  }
>()('testing/InstalledHarnessWorld') {}

const appeared = (path: string) =>
  Effect.flatMap(FileSystem.FileSystem, (files) =>
    Effect.repeat(files.exists(path), { until: (standing) => standing, schedule: Schedule.spaced('20 millis'), times: 500 }),
  );

const gone = (path: string) =>
  Effect.flatMap(FileSystem.FileSystem, (files) =>
    Effect.repeat(files.exists(path), { until: (standing) => !standing, schedule: Schedule.spaced('20 millis'), times: 500 }),
  );

const revisionOf = (registry: ProviderRegistry['Service'], other?: string) =>
  Effect.repeat(
    Effect.sync(() => registry.current().packages.get(QUILL.harness)),
    { until: (directory) => directory !== undefined && directory !== other, schedule: Schedule.spaced('20 millis'), times: 500 },
  );

const world = Layer.effect(
  World,
  Effect.gen(function* () {
    const door = yield* makeDoorWorld({ own: 'installs a provider plugin onto the machine and launches its CLI' });
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped({ prefix: 'quill-harness-' });
    const quill = yield* quillPackage(root);
    const launched = join(root, 'launched');
    yield* files.writeFileString(
      join(quill.bin, QUILL.binary),
      `#!/bin/sh\ncase "$1" in --version) echo "quill 1.0.0"; exit 0;; esac\necho "$$" > '${launched}'\nwhile IFS= read -r line; do echo "quill heard: $line"; done\n`,
      { mode: 0o755 },
    );
    return {
      op: (id: string, input: unknown, query = '') => door.op(id, input, query),
      source: quill.directory,
      bin: quill.bin,
      root,
      launched,
      projectId: yield* door.stealthProject(),
      sessions: Context.get(door.runtime.owners, SessionRead),
      asks: Context.get(door.runtime.owners, ModelAsks),
      registry: Context.get(door.runtime.owners, ProviderRegistry),
      revisions: Context.get(door.runtime.owners, PluginRevisions),
    };
  }),
);

const born = (answer: Answer) => (answer.body as { readonly snapshot: { readonly thread: { readonly id: string } } }).snapshot.thread.id;

layer(world.pipe(Layer.provideMerge(noInstall), Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'a harness a provider plugin declares',
  (it) => {
    it.effect(
      'is offered, refuses birth while its program is missing, launches its CLI, and after uninstalling its resting CLI ends, its chat reads and a turn refuses',
      () =>
        Effect.gen(function* () {
          const { op, source, bin, launched, projectId, sessions, registry } = yield* World;
          const project = `project=${projectId}`;
          expect(yield* op('install_plugin', { source }, project)).toMatchObject({
            status: 200,
            body: { status: 'ok', plugin: { id: QUILL.name, providers: { harnesses: true } } },
          });
          yield* revisionOf(registry);

          const missing = yield* op('create_thread', { type: `harness:${QUILL.harness}` }, project);
          expect(missing).toMatchObject({ status: 409, body: { code: 'harness-not-installed' } });
          expect((missing.body as { readonly unblock: readonly string[] }).unblock).toContain(QUILL.install);

          yield* onPath(bin);
          const types = yield* op('list_thread_types', { refresh: true }, project);
          expect(JSON.stringify(types.body)).toContain(`"harness:${QUILL.harness}"`);

          const created = yield* op('create_thread', { type: `harness:${QUILL.harness}`, task: '' }, project);
          expect(created).toMatchObject({
            status: 200,
            body: { snapshot: { thread: { harness: { name: QUILL.harness, presentation: { label: QUILL.label } } } } },
          });
          const threadId = born(created);
          const files = yield* FileSystem.FileSystem;
          expect((yield* sessions(threadId))?.session?.argv?.[0]).toBe(QUILL.binary);
          expect(
            yield* Effect.repeat(files.exists(launched), {
              until: (standing) => standing,
              schedule: Schedule.spaced('20 millis'),
              times: 250,
            }),
          ).toBe(true);
          const pid = Number((yield* files.readFileString(launched)).trim());
          const alive = Effect.try({ try: () => process.kill(pid, 0), catch: (cause) => cause }).pipe(
            Effect.as(true),
            Effect.catchIf(
              (cause) => Predicate.isObject(cause) && 'code' in cause && cause.code === 'ESRCH',
              () => Effect.succeed(false),
            ),
          );
          expect(yield* alive).toBe(true);

          expect(yield* op('uninstall_plugin', { id: QUILL.name }, project)).toMatchObject({ status: 200, body: { status: 'ok' } });
          const rested = yield* Effect.repeat(sessions(threadId), {
            until: (facet) => facet?.session?.state === 'ended',
            schedule: Schedule.spaced('20 millis'),
          });
          expect(rested?.session?.state).toBe('ended');
          expect(yield* alive).toBe(false);
          expect(yield* op('read_thread_snapshot', { threadId }, project)).toMatchObject({
            status: 200,
            body: {
              snapshot: { thread: { harness: { name: QUILL.harness, presentation: { label: QUILL.label, install: QUILL.install } } } },
            },
          });
          expect(yield* op('start_turn', { threadId, text: 'go on', key: crypto.randomUUID() }, project)).toMatchObject({
            status: 409,
            body: { code: 'harness-not-installed', unblock: expect.arrayContaining([QUILL.install]) },
          });
          expect(yield* op('set_thread_transport', { threadId, transport: 'acp' }, project)).toMatchObject({
            status: 409,
            body: { code: 'harness-not-installed', unblock: expect.arrayContaining([QUILL.install]) },
          });
          expect(yield* op('create_thread', { type: `harness:${QUILL.harness}` }, project)).toMatchObject({
            status: 409,
            body: { code: 'harness-not-installed' },
          });
        }),
    );

    it.effect('an ask running across a rebuild finishes on its revision, and the next ask runs the new one', () =>
      Effect.gen(function* () {
        const { op, source, root, asks, registry, projectId } = yield* World;
        const files = yield* FileSystem.FileSystem;
        expect(yield* op('install_plugin', { source }, `project=${projectId}`)).toMatchObject({ status: 200, body: { status: 'ok' } });
        const first = yield* revisionOf(registry);
        const selection = { provider: QUILL.harness, model: QUILL.model, reasoning: null, account: null };
        const gate = join(root, 'ask-gate');
        const asking = yield* Effect.forkScoped(asks.text(selection, { system: 'Answer.', input: `wait:${gate}` }));
        expect(yield* appeared(`${gate}.asked`)).toBe(true);

        yield* quillRelease(source, '2.0.0');
        const second = yield* revisionOf(registry, first);
        expect(yield* files.exists(first!)).toBe(true);

        yield* files.writeFileString(gate, '');
        expect((yield* Fiber.join(asking)).value).toBe(`quill ${QUILL.version}`);
        expect(yield* gone(first!)).toBe(false);
        expect((yield* asks.text(selection, { system: 'Answer.', input: 'now' })).value).toBe('quill 2.0.0');

        expect(yield* op('uninstall_plugin', { id: QUILL.name }, `project=${projectId}`)).toMatchObject({ status: 200 });
        expect(yield* gone(second!)).toBe(false);
      }),
    );

    it.effect('a run pinned before a rebuild asks its revision afterwards, and a retired revision takes no new hold', () =>
      Effect.gen(function* () {
        const { op, source, asks, registry, revisions, projectId } = yield* World;
        yield* quillRelease(source, QUILL.version);
        expect(yield* op('install_plugin', { source }, `project=${projectId}`)).toMatchObject({ status: 200, body: { status: 'ok' } });
        const first = (yield* revisionOf(registry))!;
        const run = crypto.randomUUID();
        registry.pinRun(run);
        yield* quillRelease(source, '2.0.0');
        yield* revisionOf(registry, first);

        const selection = { provider: QUILL.harness, model: QUILL.model, reasoning: null, account: null };
        expect((yield* asks.text(selection, { system: 'Answer.', input: 'pinned', runId: run })).value).toBe(`quill ${QUILL.version}`);
        yield* registry.releaseRun(run);
        expect(yield* gone(first)).toBe(false);
        expect(yield* Effect.scoped(revisions.hold(first))).toBe(false);
        expect(yield* op('uninstall_plugin', { id: QUILL.name }, `project=${projectId}`)).toMatchObject({ status: 200 });
      }),
    );
  },
);
