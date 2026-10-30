import { expect } from 'bun:test';
import { delimiter, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer, Predicate, Schedule } from 'effect';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { SessionRead } from '../../../threads/contract/service/harness.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { makeTerminalWorld } from '../fixture.js';
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

class World extends Context.Service<
  World,
  {
    readonly op: (id: string, input: unknown, query?: string) => Effect.Effect<Answer>;
    readonly source: string;
    readonly gate: string;
    readonly launched: string;
    readonly projectId: number;
    readonly sessions: SessionRead['Service'];
    readonly registry: ProviderRegistry['Service'];
  }
>()('testing/HeldVersionWorld') {}

const cliText = (input: {
  readonly url: string;
  readonly database: string;
  readonly gate: string;
  readonly launched: string;
}) => `#!${process.execPath}
import { existsSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('quill 1.0.0');
  process.exit(0);
}
writeFileSync(${JSON.stringify(input.launched)}, String(process.pid));
const env = { ...process.env, TAGMA_SERVER_URL: ${JSON.stringify(input.url)}, TAGMA_DATABASE_PATH: ${JSON.stringify(input.database)} };
const hook = (verb, event) =>
  Bun.spawnSync([${JSON.stringify(process.execPath)}, '--no-install', ${JSON.stringify(join(import.meta.dir, '../../entries/cli.ts'))}, 'hook', verb, '--harness', '${QUILL.harness}'], {
    cwd: process.cwd(),
    env,
    stdin: Buffer.from(JSON.stringify({ quill_session: 'quill-run', cwd: process.cwd(), ...event })),
    stdout: 'ignore',
    stderr: 'ignore',
  });
hook('session-start', { hook_event_name: 'quill.open' });
const at = args.indexOf('--say');
if (at >= 0) {
  hook('observe', { hook_event_name: 'quill.said', quill_turn: 'turn-1', quill_prompt: args[at + 1] });
  while (!existsSync(${JSON.stringify(input.gate)})) await Bun.sleep(20);
  hook('stop', { hook_event_name: 'quill.close', quill_turn: 'turn-1' });
}
for await (const line of console) console.log('quill heard: ' + line);
`;

const world = Layer.effect(
  World,
  Effect.gen(function* () {
    const terminal = yield* makeTerminalWorld({ own: 'runs an installed harness turn across the removal of its package' });
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped({ prefix: 'quill-held-' });
    const quill = yield* quillPackage(root);
    const gate = join(root, 'stop-gate');
    const launched = join(root, 'launched');
    const database = join(yield* terminal.directory('home'), 'tagma.sqlite');
    yield* files.writeFileString(join(quill.bin, QUILL.binary), cliText({ url: terminal.url, database, gate, launched }), { mode: 0o755 });
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const kept = process.env.PATH;
        process.env.PATH = [quill.bin, kept].filter((part) => part !== undefined).join(delimiter);
        return kept;
      }),
      (kept) => Effect.sync(() => void (process.env.PATH = kept)),
    );
    const checkout = yield* terminal.checkout();
    yield* spawnedEffect(['git', 'init', '-q', '-b', 'main'], { cwd: checkout.root });
    const op = (id: string, input: unknown, query = '') =>
      Effect.promise(async () => {
        const answered = await fetch(`${terminal.url}/api/op/${id}${query === '' ? '' : `?${query}`}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        });
        return { status: answered.status, body: (await answered.json()) as unknown };
      });
    return {
      op,
      source: quill.directory,
      gate,
      launched,
      projectId: checkout.id,
      sessions: Context.get(terminal.runtime.owners, SessionRead),
      registry: Context.get(terminal.runtime.owners, ProviderRegistry),
    };
  }),
);

layer(world.pipe(Layer.provideMerge(noInstall), Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'an installed harness version a live CLI holds',
  (it) => {
    it.effect(
      'stays on disk past an update and remove_adapter, so the running turn ends as its own version reads it and the CLI ends at rest',
      () =>
        Effect.gen(function* () {
          const { op, source, gate, launched, projectId, sessions, registry } = yield* World;
          const files = yield* FileSystem.FileSystem;
          expect(yield* op('install_adapter', { source })).toMatchObject({ status: 200, body: { status: 'installed' } });
          const version = registry.current().packages.get(QUILL.harness)!;
          const created = yield* op('create_thread', { type: `harness:${QUILL.harness}`, task: 'go' }, `project=${projectId}`);
          expect(created.status).toBe(200);
          const threadId = (created.body as { readonly snapshot: { readonly thread: { readonly id: string } } }).snapshot.thread.id;
          const turning = yield* Effect.repeat(sessions(threadId), {
            until: (facet) => facet?.turn?.movedAt !== undefined,
            schedule: Schedule.spaced('20 millis'),
          });
          expect(turning?.session?.package).toBe(version);

          yield* quillRelease(source, '2.0.0', 'quill.end');
          expect(yield* op('update_adapter', { id: QUILL.name })).toMatchObject({ status: 200 });
          const updated = registry.current().packages.get(QUILL.harness)!;
          expect(updated).not.toBe(version);
          expect(yield* op('remove_adapter', { id: QUILL.name })).toMatchObject({ status: 200, body: { status: 'removed' } });
          expect(yield* files.exists(version)).toBe(true);
          expect(yield* files.exists(updated)).toBe(false);

          yield* files.writeFileString(gate, '');
          const ended = yield* Effect.repeat(sessions(threadId), {
            until: (facet) => facet?.session?.state === 'ended',
            schedule: Schedule.spaced('20 millis'),
          });
          expect(ended?.turn).toBeUndefined();
          const pid = Number((yield* files.readFileString(launched)).trim());
          const alive = yield* Effect.try({ try: () => process.kill(pid, 0), catch: (cause) => cause }).pipe(
            Effect.as(true),
            Effect.catchIf(
              (cause) => Predicate.isObject(cause) && 'code' in cause && cause.code === 'ESRCH',
              () => Effect.succeed(false),
            ),
          );
          expect(alive).toBe(false);
        }),
    );
  },
);
