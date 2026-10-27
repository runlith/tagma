import { beforeAll, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunSocketServer from '@effect/platform-bun/BunSocketServer';
import { conformance, type Launch } from '@runlith/audio/conformance/scenario';
import { HelperAbsent } from '@runlith/audio/helper/channel';
import { Deferred, Effect, FileSystem } from 'effect';
import type { Socket } from 'effect/socket/Socket';

let binary: string;

beforeAll(async () => {
  const script = fileURLToPath(new URL('../scripts/build-native.mjs', import.meta.url));
  const { stdout } = await promisify(execFile)('node', [script, '--print-path']);
  binary = stdout.trim();
});

it.live('the built Swift helper conforms over a Unix socket', () =>
  Effect.gen(function* () {
    let process: ChildProcess | undefined;
    const data = mkdtempSync(join(tmpdir(), 'audio-conformance-data-'));
    const launch: Launch = Effect.fn('AudioConformance.launch')(
      function* (token) {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ directory: '/tmp', prefix: 'audio-conformance-' });
        yield* fs.chmod(directory, 0o700);
        const path = `${directory}/s`;
        const server = yield* BunSocketServer.make({ path });
        const connected = yield* Deferred.make<Socket>();
        yield* server.run((socket) => Deferred.succeed(connected, socket).pipe(Effect.andThen(Effect.never))).pipe(Effect.forkScoped);
        let stderr = '';
        process = spawn(binary, ['--socket', path, '--token', token, '--data', data, '--synthetic'], {
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        process.stderr!.on('data', (data) => {
          stderr += data.toString();
        });
        const child = process;
        const exit = new Promise<void>((resolve, reject) => {
          child.on('error', reject);
          child.on('exit', (code, signal) => (code === 0 ? resolve() : reject(new Error(`helper exited ${code ?? signal}: ${stderr}`))));
        });
        void exit.catch(() => undefined);
        const socket = yield* Effect.raceFirst(
          Deferred.await(connected),
          Effect.promise(() => exit).pipe(Effect.andThen(Effect.die('helper exited before connecting'))),
        );
        return { socket, exited: Effect.promise(() => exit) };
      },
      Effect.provide(BunFileSystem.layer),
      Effect.mapError((error) => new HelperAbsent({ reason: String(error), unblock: ['Build the native helper.'] })),
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (process?.exitCode === null) process.kill();
        rmSync(data, { recursive: true, force: true });
      }),
    );
    const passed = yield* conformance(launch);
    expect(passed).toHaveLength(10);
  }),
);

test('a started helper returns the sound a holder that no longer exists left muted', async () => {
  const data = mkdtempSync(join(tmpdir(), 'audio-recovery-'));
  try {
    const journal = join(data, 'audio-mute');
    mkdirSync(journal);
    const record = (device: string) => JSON.stringify({ device, original: false, holders: [{ pid: 1, started: 1 }] });
    writeFileSync(join(journal, 'device.json'), record('synthetic'));
    writeFileSync(join(journal, 'absent.json'), record('elsewhere'));
    const child = spawn(binary, ['--socket', join(data, 'none'), '--token', 'x', '--data', data, '--synthetic'], { stdio: 'ignore' });
    await new Promise((resolve) => child.on('exit', resolve));
    expect(readdirSync(journal).filter((name) => name.endsWith('.json'))).toEqual(['absent.json']);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});
