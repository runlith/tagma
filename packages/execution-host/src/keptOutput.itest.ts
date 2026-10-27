import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem, Layer, Stream } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import type { Client } from '@runlith/executions/ExecutionClient';
import { HostRequestKey, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { hostPolicy, hostShare, hostWireLimits, principalOf } from './hostFixture';
import { makeWorld } from './composition/testing/servedWorld';

const policy = hostPolicy({ executions: 2, transports: ['pipes'], custodyReceipts: 8 });
const limits = hostWireLimits(policy, 2, { envelopeBytes: 16384, connections: 2, requests: 8 });
const platform = Layer.mergeAll(HostRegistration.layer, endpointConnection).pipe(Layer.provideMerge(BunServices.layer));
const principal = principalOf('tester');

const ended = Effect.fnUntraced(function* (
  client: Client,
  key: (name: string) => HostRequestRef,
  name: string,
  script: string,
  cwd: string,
) {
  const launch: LaunchRequest = {
    command: { program: '/bin/sh', args: ['-c', script], environment: [] },
    transport: { _tag: 'pipes', stdin: 'ignore' },
    lifetime: 'command',
    purpose: 'command',
    target: { environment: 'e', namespace: 'n', cwd, dependencies: [] },
    holder: principal,
    origin: principal,
    admission: {
      origin: { scope: 'project-1', owner: 'tester', cohort: 'wave-1' },
      limits: { executionMs: 600_000, executionCeilingMs: 900_000 },
      policyIdentity: 'policy-1',
    },
  };
  const started = yield* client.start(key(name), launch);
  if (started._tag !== 'Started' && started._tag !== 'Accepted')
    return yield* Effect.die(new Error(`${name} did not start: ${started._tag}`));
  const decided = yield* Stream.runHead(
    Stream.filter(
      client.subscribe({ _tag: 'State', execution: started.execution }, limits.credits),
      (delivery) => delivery._tag === 'State' && delivery.summary.decision !== undefined,
    ),
  );
  if (decided._tag === 'None' || decided.value._tag !== 'State') return yield* Effect.die(new Error(`${name} was never decided`));
  return { ref: started.execution, summary: decided.value.summary };
});

layer(platform, { excludeTestServices: true })('the output of an ended command kept as a file', (it) => {
  it.effect(
    'holds the retained output byte for byte once the command is decided, names the bytes it lost, and is absent for no output',
    Effect.fnUntraced(function* () {
      const files = yield* FileSystem.FileSystem;
      const { client, directory, registration } = yield* makeWorld({
        prefix: 'kept-output-',
        policy,
        share: hostShare(policy, 2),
        limits,
      });
      const key = (name: string): HostRequestRef => ({ installation: registration.installation, operation: HostRequestKey.make(name) });
      expect((yield* client.take(key('kept-take'), 0))._tag).toBe('Held');
      const retained = policy.execution.output.retainedBytes;
      const runs = {
        short: yield* ended(client, key, 'kept-short', "printf 'one\\n'; printf 'two\\n' >&2; printf 'three\\n'", directory),
        long: yield* ended(client, key, 'kept-long', `head -c ${retained * 2} /dev/zero | tr '\\0' x; printf end`, directory),
        silent: yield* ended(client, key, 'kept-silent', 'true', directory),
      };
      const kept = Effect.fnUntraced(function* (run: (typeof runs)['short']) {
        const file = run.summary.outputFile;
        if (file === undefined) return undefined;
        const held = yield* files.readFile(file.path);
        const streamed = yield* Stream.runCollect(
          Stream.takeUntil(
            client.subscribe({ _tag: 'Bytes', cursor: { ref: run.ref, stream: 'output', offset: file.from } }, 65536),
            (delivery) => delivery._tag === 'Ended',
          ),
        );
        const bytes = Buffer.concat(streamed.flatMap((delivery) => (delivery._tag === 'Bytes' ? [delivery.bytes] : [])));
        return { file, held: Buffer.from(held), bytes };
      });
      const short = yield* kept(runs.short);
      const long = yield* kept(runs.long);

      expect(short?.file.from).toBe(byteOffset(0n));
      expect(short?.held.equals(short.bytes)).toBe(true);
      expect(short?.held.toString().split('\n').toSorted()).toEqual(['', 'one', 'three', 'two']);
      expect(long === undefined ? undefined : BigInt(long.file.from) > 0n).toBe(true);
      expect(long?.file.through).toBe(byteOffset(BigInt(retained * 2 + 3)));
      expect(long?.held.equals(long.bytes)).toBe(true);
      expect(long?.held.toString().endsWith('end')).toBe(true);
      expect(runs.silent.summary.outputFile).toBeUndefined();
    }),
  );
});
