import { expect } from 'bun:test';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Effect, Layer, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import * as BunServices from '@effect/platform-bun/BunServices';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { HostRequestKey, type HostRequestRef } from '@runlith/executions/protocol/execution';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { hostPolicy, hostShare, hostWireLimits, principalOf } from './hostFixture';
import { makeWorld } from './composition/testing/servedWorld';
import { Bundle, bundleFixture } from './composition/testing/artifact';
import { RECOVERY_ENTRY } from './buildArtifact';

const policy = hostPolicy({ executions: 2, transports: ['pipes'], custodyReceipts: 16 });
const limits = hostWireLimits(policy, 2, { envelopeBytes: 16384, connections: 4, requests: 8 });
const platform = Layer.mergeAll(HostRegistration.layer, endpointConnection, bundleFixture).pipe(Layer.provideMerge(BunServices.layer));
type Invocation = { readonly state: string; readonly args: readonly string[] };
const recovery = Effect.fnUntraced(function* ({ state, args }: Invocation) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const bundle = yield* Bundle;
  const child = yield* spawner.spawn(
    ChildProcess.make(process.execPath, [join(bundle.root, RECOVERY_ENTRY), state, ...args], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    }),
  );
  const [stdout, stderr, code] = yield* Effect.all(
    [
      Stream.runCollect(child.stdout).pipe(Effect.map((chunks) => Buffer.concat(chunks).toString())),
      Stream.runCollect(child.stderr).pipe(Effect.map((chunks) => Buffer.concat(chunks).toString())),
      child.exitCode,
    ],
    { concurrency: 3 },
  );
  expect(Number(code)).toBe(0);
  expect(stderr).toBe('');
  return stdout;
}, Effect.scoped);
const linesOf = (stdout: string) => stdout.trim().split('\n');
const ROW = /^(\S+) (\d+) (\S+) (\S+) cleanup (\S+) record (\S+)$/;

layer(platform, { excludeTestServices: true, testTimeout: '30 seconds' })('the recovery program against a live host', (it) => {
  it.effect(
    'pages current identities, repeats a stop receipt exactly, reads its operation and shuts down',
    Effect.fnUntraced(function* () {
      const { client, directory, registration } = yield* makeWorld({
        prefix: 'recovery-road-',
        policy,
        limits,
        share: hostShare(policy, 2),
      });
      const invoke = (args: readonly string[]) => recovery({ state: directory, args });
      const status = linesOf(yield* invoke(['status']));
      expect(status[0]).toMatch(new RegExp(`^installation ${registration.installation} incarnation \\d+ \\S+$`));
      expect(status[1]?.startsWith('artifact ')).toBe(true);
      const key = (name: string): HostRequestRef => ({ installation: registration.installation, operation: HostRequestKey.make(name) });
      expect((yield* client.take(key('take'), 0))._tag).toBe('Held');
      const principal = principalOf('tester');
      const request: LaunchRequest = {
        command: { program: '/bin/cat', args: [], environment: [], cwd: directory },
        transport: { _tag: 'pipes', stdin: 'pipe' },
        lifetime: 'call',
        purpose: 'command',
        target: { environment: 'e', namespace: 'n', cwd: directory, dependencies: [] },
        holder: principal,
        origin: principal,
      };
      const refs = yield* Effect.forEach(
        ['first', 'second'],
        Effect.fnUntraced(function* (name) {
          const started = yield* client.start(key(name), request);
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`the child did not start: ${started._tag}`));
          return started.execution;
        }),
      );
      const listed = linesOf(yield* invoke(['list']));
      expect(listed).toHaveLength(2);
      const identities = listed.map((row) => {
        expect(row).toMatch(ROW);
        return row.split(' ')[0];
      });
      expect(new Set(identities)).toEqual(new Set(refs.map((ref) => ref.execution)));
      const firstPage = linesOf(yield* invoke(['list', 'limit', '1']));
      expect(firstPage).toHaveLength(2);
      const cursor = /^more after (\S+) (\d+)$/.exec(firstPage[1] ?? '');
      if (cursor?.[1] === undefined || cursor[2] === undefined)
        return yield* Effect.die(new Error(`the page has no continuation: ${firstPage.join('\n')}`));
      const secondPage = linesOf(yield* invoke(['list', cursor[1], cursor[2]]));
      expect(secondPage).toHaveLength(1);
      expect(new Set([firstPage[0], secondPage[0]])).toEqual(new Set(listed));
      const first = refs[0];
      if (first === undefined) return yield* Effect.die(new Error('the first child has no reference'));
      const stop = ['stop', 'host-recover-road-stop', first.execution, String(first.incarnation)];
      const stopped = yield* invoke(stop);
      expect(stopped.trim()).toMatch(/^(leader|covered|partial|unknown) confirmed \d+ residual \d+ unverifiable \d+$/);
      expect(yield* invoke(stop)).toBe(stopped);
      expect((yield* invoke(['operation', 'host-recover-road-stop'])).trim()).toMatch(/^host-recover-road-stop Accepted execution /);
      const second = refs[1];
      if (second === undefined) return yield* Effect.die(new Error('the second child has no reference'));
      yield* client.stop(key('second-stop'), second, 'explicit-stop', 'destroy');
      expect(linesOf(yield* invoke(['shutdown', 'host-recover-road-down']))[0]).toBe('ShutdownComplete');
    }),
  );
});
