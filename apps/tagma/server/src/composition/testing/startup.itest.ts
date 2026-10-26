import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect, FileSystem, Schema } from 'effect';
import { readStartup } from '../../installation/process/record.js';
import { startupStateSchema } from '../../installation/contract/wire/restart.js';

const server = new URL('../server.ts', import.meta.url).pathname;
const cli = new URL('../entries/cli.ts', import.meta.url).pathname;

const spawn = (entry: string, root: string, port: number, args: string[] = []) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn([process.execPath, entry, ...args], {
        env: {
          HOME: root,
          PATH: process.env.PATH,
          TAGMA_DATABASE_PATH: join(root, 'machine.sqlite'),
          TAGMA_INSTALL_ROOT: join(root, 'install'),
          TAGMA_SEED_DIRECTORY: join(root, 'seeds'),
          TAGMA_PORT: String(port),
          TAGMA_ARTIFACT_PORT: '0',
          TAGMA_REMOTE_PORT: '0',
          TAGMA_SANDBOX_PORT: '0',
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      }),
    ),
    (child) =>
      Effect.promise(async () => {
        if (child.exitCode === null) child.kill('SIGKILL');
        await child.exited;
      }),
  );

const outputOf = (child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>) =>
  Effect.promise(async () => ({
    out: await new Response(child.stdout).text(),
    error: await new Response(child.stderr).text(),
  }));

it.live('an occupied local port leaves a failed startup that status reads after the process exits', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-startup-process-' });
    const { port, state } = yield* Effect.scoped(
      Effect.gen(function* () {
        const held = yield* Effect.acquireRelease(
          Effect.sync(() => Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('held') })),
          (listening) => Effect.promise(() => listening.stop(true)),
        );
        const port = held.port!;
        const child = yield* spawn(server, root, port);
        const code = yield* Effect.promise(() => child.exited);
        const output = yield* outputOf(child);
        const state = yield* readStartup(join(root, 'restart.json'));
        expect(code, output.error).not.toBe(0);
        expect(state.startup, output.error).toMatchObject({ status: 'failed', phase: 'local door opened', readyAt: null });
        expect(state.startup?.failure?.detail).toContain(String(port));
        expect(yield* Effect.promise(async () => (await fetch(`http://127.0.0.1:${port}`)).text())).toBe('held');
        return { port, state };
      }),
    );
    const status = yield* spawn(cli, root, port, ['status', '--json']);
    const code = yield* Effect.promise(() => status.exited);
    const answer = yield* outputOf(status);
    expect(code, answer.error).toBe(0);
    const decoded = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.Struct({ ready: Schema.Literal(false), ...startupStateSchema.fields })),
    )(answer.out);
    expect(decoded).toEqual({ ready: false, ...state });
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
