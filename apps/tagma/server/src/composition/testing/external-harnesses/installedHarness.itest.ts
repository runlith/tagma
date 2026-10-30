import { expect } from 'bun:test';
import { delimiter, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer, Schedule } from 'effect';
import { SessionRead } from '../../../threads/contract/service/harness.js';
import { makeDoorWorld } from '../doorFixture.js';
import { QUILL, quillPackage } from './quill.js';

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
    readonly launched: string;
    readonly projectId: number;
    readonly sessions: SessionRead['Service'];
  }
>()('testing/InstalledHarnessWorld') {}

const world = Layer.effect(
  World,
  Effect.gen(function* () {
    const door = yield* makeDoorWorld({ own: 'installs an adapter package into the machine and launches its CLI' });
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped({ prefix: 'quill-harness-' });
    const quill = yield* quillPackage(root);
    const launched = join(root, 'launched');
    yield* files.writeFileString(
      join(quill.bin, QUILL.binary),
      `#!/bin/sh\ncase "$1" in --version) echo "quill 1.0.0"; exit 0;; esac\necho "$0" > '${launched}'\nwhile IFS= read -r line; do echo "quill heard: $line"; done\n`,
      { mode: 0o755 },
    );
    return {
      op: (id: string, input: unknown, query = '') => door.op(id, input, query),
      source: quill.directory,
      bin: quill.bin,
      launched,
      projectId: yield* door.stealthProject(),
      sessions: Context.get(door.runtime.owners, SessionRead),
    };
  }),
);

const born = (answer: Answer) => (answer.body as { readonly snapshot: { readonly thread: { readonly id: string } } }).snapshot.thread.id;

layer(world.pipe(Layer.provideMerge(noInstall), Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'a harness an installed package declares',
  (it) => {
    it.effect(
      'is offered, refuses birth while its program is missing, launches its CLI, and after removal its chat reads while a turn refuses',
      () =>
        Effect.gen(function* () {
          const { op, source, bin, launched, projectId, sessions } = yield* World;
          const project = `project=${projectId}`;
          expect(yield* op('install_adapter', { source })).toMatchObject({ status: 200, body: { status: 'installed' } });

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

          expect(yield* op('remove_adapter', { id: QUILL.name })).toMatchObject({ status: 200, body: { status: 'removed' } });
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
  },
);
