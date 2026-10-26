import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem, Schema, Stream } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { ARTIFACT_FILE, Digest } from '@runlith/executions/protocol/artifact';
import { ExecutionId, InstallationId, HostRequestKey } from '@runlith/executions/protocol/execution';
import { OperationAnswer } from '@runlith/executions/protocol/runtime';
import { ShutdownAnswer } from '@runlith/executions/protocol/stop';
import { WIRE_VERSION } from '@runlith/executions/protocol/wire';
import {
  formatListCursor,
  formatListRow,
  formatOperationLine,
  formatShutdownLine,
  formatVersion,
  readBundleManifest,
  readListArgs,
  readListCursor,
  readListLimit,
  readOperationKey,
  request,
  type ListedRow,
} from './recovery';

const installation = InstallationId.make('installation-1');
const execution = ExecutionId.make('execution-1');
const RECOVERY = join(import.meta.dir, 'recovery.ts');
type Output = { readonly code: number; readonly stdout: string; readonly stderr: string };
const run = Effect.fnUntraced(function* (args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make(process.execPath, [RECOVERY, ...args], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    }),
  );
  const collected = (stream: typeof child.stdout) =>
    Stream.runCollect(stream).pipe(Effect.map((chunks) => Buffer.concat(chunks).toString()));
  const [stdout, stderr, code] = yield* Effect.all([collected(child.stdout), collected(child.stderr), child.exitCode], { concurrency: 3 });
  return { code: Number(code), stdout, stderr } satisfies Output;
}, Effect.scoped);

const directory = FileSystem.FileSystem.use((fs) => fs.makeTempDirectoryScoped({ prefix: 'recovery-' }));
const digest = Digest.make(`sha256:${'0123456789abcdef'.repeat(4)}`);
const manifest = {
  identity: { digest, build: 'test-build' },
  protocol: 'executions/1',
  platform: { os: 'darwin', arch: 'arm64' },
  endpoint: { transport: 'unix', path: 'host.sock' },
  wire: { min: WIRE_VERSION, max: WIRE_VERSION },
  parts: [{ role: 'runtime', path: 'bun', bytes: 1, digest }],
};

layer(BunServices.layer, { excludeTestServices: true })('recovery arguments and manifest', (it) => {
  it.effect(
    'a request names the state directory, the verb and the rest',
    Effect.fnUntraced(function* () {
      expect(yield* request(['bun', 'recovery.js', '/state', 'list', 'after', '5'])).toEqual({
        state: '/state',
        verb: 'list',
        arguments: ['after', '5'],
      });
      for (const argv of [
        ['bun', 'recovery.js', '/state'],
        ['bun', 'recovery.js', '/state', 'start'],
      ]) {
        expect((yield* Effect.flip(request(argv)))._tag).toBe('RecoveryRefused');
      }
    }),
  );

  it.effect(
    'a caller-minted key passes through and a missing or empty key is refused',
    Effect.fnUntraced(function* () {
      for (const name of ['host-recover-550e8400-e29b-41d4-a716-446655440000', '<key>']) {
        expect(yield* readOperationKey(name, 'shutdown', installation)).toEqual({ installation, operation: HostRequestKey.make(name) });
      }
      for (const name of [undefined, '']) {
        expect((yield* Effect.flip(readOperationKey(name, 'shutdown', installation)))._tag).toBe('RecoveryRefused');
      }
    }),
  );

  it.effect(
    'a list applies its default or explicit positive page size and refuses an invalid one',
    Effect.fnUntraced(function* () {
      expect(yield* readListLimit(undefined)).toBe(100);
      expect(yield* readListLimit('25')).toBe(25);
      for (const value of ['0', 'many']) expect((yield* Effect.flip(readListLimit(value)))._tag).toBe('RecoveryRefused');
    }),
  );

  it.effect(
    'list arguments spell the count first and the cursor after it',
    Effect.fnUntraced(function* () {
      expect(yield* readListArgs([], installation)).toEqual({ after: undefined, limit: 100 });
      expect(yield* readListArgs(['limit', '10'], installation)).toEqual({ after: undefined, limit: 10 });
      expect(yield* readListArgs(['limit', '10', 'execution-1', '5'], installation)).toEqual({
        after: { installation, execution, incarnation: 5 },
        limit: 10,
      });
      expect(yield* readListArgs(['execution-1', '5'], installation)).toEqual({
        after: { installation, execution, incarnation: 5 },
        limit: 100,
      });
      for (const args of [['limit'], ['limit', 'many'], ['execution-1', '5', '10']]) {
        expect((yield* Effect.flip(readListArgs(args, installation)))._tag).toBe('RecoveryRefused');
      }
    }),
  );

  it.effect(
    'a list cursor names the previous page boundary and refuses an incomplete or invalid identity',
    Effect.fnUntraced(function* () {
      expect(yield* readListCursor(undefined, undefined, installation)).toBeUndefined();
      expect(yield* readListCursor('execution-1', undefined, installation)).toEqual({ installation, execution, incarnation: 0 });
      expect(yield* readListCursor('execution-1', '5', installation)).toEqual({ installation, execution, incarnation: 5 });
      for (const [name, incarnation] of [
        [undefined, '5'],
        ['execution-1', 'many'],
        ['', '0'],
        ['execution-1', '9007199254740992'],
      ]) {
        expect((yield* Effect.flip(readListCursor(name, incarnation, installation)))._tag).toBe('RecoveryRefused');
      }
    }),
  );

  it.effect(
    'a bundle manifest reads as its identity, while missing or invalid metadata stays unknown',
    Effect.fnUntraced(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* directory;
      yield* fs.writeFileString(join(root, ARTIFACT_FILE), JSON.stringify(manifest));
      expect(yield* readBundleManifest(root)).toEqual({ digest, build: 'test-build' });
      const missing = yield* directory;
      expect(yield* readBundleManifest(missing)).toBeUndefined();
      for (const content of ['{ not json', JSON.stringify({ unrelated: true })]) {
        const invalid = yield* directory;
        yield* fs.writeFileString(join(invalid, ARTIFACT_FILE), content);
        expect(yield* readBundleManifest(invalid)).toBeUndefined();
      }
    }),
  );

  it.effect(
    'the program answers its version with no state standing at all',
    Effect.fnUntraced(function* () {
      const root = yield* directory;
      const answered = yield* run([join(root, 'no-such-state'), 'version']);
      expect(answered.code).toBe(0);
      expect(answered.stdout.trim()).toBe(`wire ${WIRE_VERSION} bundle unknown`);
    }),
  );

  it.effect(
    'a refused verb exits non-zero and carries its supplied words on one output line',
    Effect.fnUntraced(function* () {
      const root = yield* directory;
      const answered = yield* run([root, 'unknown\nverb']);
      expect(answered.code).not.toBe(0);
      const lines = answered.stdout.trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('unknown verb');
    }),
  );
});

const row: ListedRow = {
  state: {
    ref: { installation, execution, incarnation: 5 },
    phase: 'running',
    transport: 'pty',
    lifetime: 'held',
    purpose: 'command',
    cleanup: 'pending',
    record: 'available',
    streams: { stdout: 'eof', stderr: 'eof', pty: 'open' },
  },
};

test('a list row and continuation print the grammar the server reads', () => {
  expect(formatListRow(row)).toBe('execution-1 5 running pty cleanup pending record available');
  expect(formatListCursor(row.state.ref)).toBe('more after execution-1 5');
});

test('a version names the wire beside the bundle that reports it', () => {
  expect(formatVersion(WIRE_VERSION, { digest, build: 'test-build' })).toBe(`wire ${WIRE_VERSION} bundle ${digest} build test-build`);
  expect(formatVersion(WIRE_VERSION, undefined)).toBe(`wire ${WIRE_VERSION} bundle unknown`);
});

test('a shutdown prints its tag and a refusal or uncertain effect names what to act on', () => {
  const read = Schema.decodeUnknownSync(ShutdownAnswer);
  const key = { installation: 'installation-1', operation: 'host-recover-1' };
  expect(formatShutdownLine(read({ _tag: 'ShutdownComplete', operation: key, executions: [] }))).toBe('ShutdownComplete');
  expect(
    formatShutdownLine(read({ _tag: 'ShutdownIncomplete', operation: key, executions: [], residual: [], unverifiable: [], reason: 'no' })),
  ).toBe('ShutdownIncomplete');
  expect(
    formatShutdownLine(read({ _tag: 'Refused', operation: key, refusal: { _tag: 'Unauthorized', reason: 'not the custodian' } })),
  ).toBe('Refused Unauthorized: not the custodian');
  expect(formatShutdownLine(read({ _tag: 'Uncertain', effect: { _tag: 'InFlight', operation: key } }))).toBe(
    'Uncertain InFlight host-recover-1',
  );
});

test('a key read back prints the whole actionable answer', () => {
  const read = Schema.decodeUnknownSync(OperationAnswer);
  const key = { installation: 'installation-1', operation: 'host-recover-1' };
  expect(
    formatOperationLine(
      read({ _tag: 'Accepted', operation: key, execution: { installation: 'installation-1', execution: 'execution-1', incarnation: 5 } }),
    ),
  ).toBe('Accepted execution execution-1 5');
  expect(formatOperationLine(read({ _tag: 'Accepted', operation: key }))).toBe('Accepted');
  expect(formatOperationLine(read({ _tag: 'Cancelled', operation: key }))).toBe('Cancelled');
  expect(formatOperationLine(read({ _tag: 'Unanswered', operation: key }))).toBe('Unanswered');
  expect(
    formatOperationLine(read({ _tag: 'Refused', operation: key, refusal: { _tag: 'Unauthorized', reason: 'not the custodian' } })),
  ).toBe('Refused Unauthorized: not the custodian');
  expect(formatOperationLine(read({ _tag: 'Uncertain', effect: { _tag: 'InFlight', operation: key } }))).toBe(
    'Uncertain InFlight host-recover-1',
  );
});
