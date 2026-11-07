import { expect } from 'bun:test';
import { delimiter, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { Context, Effect, FileSystem, Layer, Predicate, Schedule } from 'effect';
import { HostManagement } from '../../../executions/contract/service/host.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { SessionRead } from '../../../threads/contract/service/harness.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { makeTerminalWorld, servedRuntime, type TerminalRuntime, terminalRuntime } from '../fixture.js';
import { hostBundleRoot } from '../hostBundle.js';
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
    readonly asking: string;
    readonly served: string;
    readonly launched: string;
    readonly home: string;
    readonly projectId: number;
    readonly runtime: TerminalRuntime;
  }
>()('testing/HeldVersionWorld') {}

const cliText = (input: {
  readonly served: string;
  readonly database: string;
  readonly gate: string;
  readonly asking: string;
  readonly launched: string;
}) => `#!${process.execPath}
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('quill 1.0.0');
  process.exit(0);
}
writeFileSync(${JSON.stringify(input.launched)}, String(process.pid));
const hook = (verb, event) =>
  Bun.spawnSync([${JSON.stringify(process.execPath)}, '--no-install', ${JSON.stringify(join(import.meta.dir, '../../developer/cli.ts'))}, 'hook', verb, '--harness', '${QUILL.harness}'], {
    cwd: process.cwd(),
    env: { ...process.env, TAGMA_SERVER_URL: readFileSync(${JSON.stringify(input.served)}, 'utf8'), TAGMA_DATABASE_PATH: ${JSON.stringify(input.database)} },
    stdin: Buffer.from(JSON.stringify({ quill_session: 'quill-run', cwd: process.cwd(), ...event })),
    stdout: 'ignore',
    stderr: 'ignore',
  });
hook('session-start', { hook_event_name: 'quill.open' });
const at = args.indexOf('--say');
if (at >= 0) {
  hook('observe', { hook_event_name: 'quill.said', quill_turn: 'turn-1', quill_prompt: args[at + 1] });
  let asked = false;
  while (!existsSync(${JSON.stringify(input.gate)})) {
    if (!asked && existsSync(${JSON.stringify(input.asking)})) {
      console.log('quill asks: Proceed?');
      asked = true;
    }
    await Bun.sleep(20);
  }
  hook('stop', { hook_event_name: 'quill.close', quill_turn: 'turn-1' });
}
for await (const line of console) console.log('quill heard: ' + line);
`;

const world = Layer.effect(
  World,
  Effect.gen(function* () {
    const terminal = yield* makeTerminalWorld({ own: 'runs an installed harness turn across the removal of its package and a restart' });
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped({ prefix: 'quill-held-' });
    const quill = yield* quillPackage(root);
    const gate = join(root, 'stop-gate');
    const asking = join(root, 'ask-gate');
    const served = join(root, 'served');
    const launched = join(root, 'launched');
    const home = yield* terminal.directory('home');
    yield* files.writeFileString(served, terminal.url);
    yield* files.writeFileString(
      join(quill.bin, QUILL.binary),
      cliText({ served, database: join(home, 'tagma.sqlite'), gate, asking, launched }),
      { mode: 0o755 },
    );
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
    return { op, source: quill.directory, gate, asking, served, launched, home, projectId: checkout.id, runtime: terminal.runtime };
  }),
);

const ended = (pid: number) =>
  Effect.try({ try: () => process.kill(pid, 0), catch: (cause) => cause }).pipe(
    Effect.as(false),
    Effect.catchIf(
      (cause) => Predicate.isObject(cause) && 'code' in cause && cause.code === 'ESRCH',
      () => Effect.succeed(true),
    ),
  );

layer(world.pipe(Layer.provideMerge(noInstall), Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'an installed harness version a live CLI holds',
  (it) => {
    it.effect(
      'reads its screen with that version past an update, and after removal and a restart its turn ends as that version reads it, the CLI ends at rest and its revision goes',
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { op, source, gate, asking, served, launched, home, projectId, runtime } = yield* World;
            const files = yield* FileSystem.FileSystem;
            const registry = Context.get(runtime.owners, ProviderRegistry);
            const revision = (other?: string) =>
              Effect.repeat(
                Effect.sync(() => registry.current().packages.get(QUILL.harness)),
                {
                  until: (directory) => directory !== undefined && directory !== other,
                  schedule: Schedule.spaced('20 millis'),
                  times: 500,
                },
              );
            expect(yield* op('install_plugin', { source }, `project=${projectId}`)).toMatchObject({ status: 200, body: { status: 'ok' } });
            const version = (yield* revision())!;
            const created = yield* op('create_thread', { type: `harness:${QUILL.harness}`, task: 'go' }, `project=${projectId}`);
            expect(created.status).toBe(200);
            const threadId = (created.body as { readonly snapshot: { readonly thread: { readonly id: string } } }).snapshot.thread.id;
            const turning = yield* Effect.repeat(Context.get(runtime.owners, SessionRead)(threadId), {
              until: (facet) => facet?.turn?.movedAt !== undefined,
              schedule: Schedule.spaced('20 millis'),
            });
            expect(turning?.session?.package).toBe(version);

            yield* quillRelease(source, '2.0.0', 'quill.end', false);
            const updated = (yield* revision(version))!;
            yield* files.writeFileString(asking, '');
            yield* Effect.repeat(Context.get(runtime.owners, ThreadHarness).reads.snapshot(threadId), {
              until: (snapshot) => snapshot.status.openQuestions.some((id) => id.startsWith('harness-screen:')),
              schedule: Schedule.spaced('20 millis'),
            });
            expect(yield* op('uninstall_plugin', { id: QUILL.name }, `project=${projectId}`)).toMatchObject({ status: 200 });
            yield* Effect.repeat(files.exists(updated), {
              until: (standing) => !standing,
              schedule: Schedule.spaced('20 millis'),
              times: 500,
            });
            expect(yield* files.exists(version)).toBe(true);
            expect(yield* files.exists(updated)).toBe(false);

            const digest = Context.get(runtime.executions, HostManagement).connection.address.digest;
            if (digest == null) return yield* Effect.die(new Error('the terminal world host has no offered bundle'));
            yield* runtime.closeStack;
            yield* runtime.pool.dispose();
            yield* runtime.runtime.disposeEffect;
            const restarted = yield* terminalRuntime(
              home,
              {
                hostBundlePath: yield* Effect.orDie(hostBundleRoot),
                placedHost: { _tag: 'Standing', digest, detail: 'the restarted server keeps the host its CLI runs in' },
              },
              yield* heldPool,
            );
            yield* files.writeFileString(served, yield* servedRuntime(restarted, home));
            for (const transport of Context.get(restarted.owners, ThreadHarness).runs.transports().all())
              if (transport.resource !== undefined) yield* transport.resource.watch().pipe(Effect.provide(restarted.owners));
            yield* files.writeFileString(gate, '');
            const settled = yield* Effect.repeat(Context.get(restarted.owners, SessionRead)(threadId), {
              until: (facet) => facet?.session?.state === 'ended',
              schedule: Schedule.spaced('20 millis'),
            });
            expect(settled?.turn).toBeUndefined();
            expect(yield* ended(Number((yield* files.readFileString(launched)).trim()))).toBe(true);
            expect(
              yield* Effect.repeat(files.exists(version), {
                until: (standing) => !standing,
                schedule: Schedule.spaced('20 millis'),
                times: 500,
              }),
            ).toBe(false);
          }),
        ),
    );
  },
);
