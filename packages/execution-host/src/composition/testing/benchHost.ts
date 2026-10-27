import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Duration, Effect, Schedule, Schema } from 'effect';
import { ExecutionClient } from '@runlith/executions/ExecutionClient';
import type { HostAuthority } from '@runlith/executions/HostAuthority';
import { HostBoot } from '@runlith/executions/protocol/boot';
import { ExecutionPolicy } from '@runlith/executions/protocol/capacity';
import type { WireLimits } from '@runlith/executions/protocol/wire';
import { keyOf, registrationOf } from '../../hostFixture';
import { HOLDER_LIBRARY } from '../../posix/testing/holder';

export const benchFlag = (name: string, fallback: number): number => {
  const given = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  return given === undefined ? fallback : Number(given.slice(name.length + 3));
};

export const BENCH_POLICY = Schema.decodeUnknownSync(ExecutionPolicy)({
  transports: ['pipes', 'pty'],
  relations: ['leader'],
  execution: {
    input: { pendingBytes: 65536, chunkBytes: 16384, receipts: 128 },
    output: { landingBytes: 16384, segmentBytes: 262144, retainedBytes: 8388608 },
    parser: { pendingBytes: 262144, cellBytes: 234881024 },
    geometry: { columns: 320, rows: 100, scrollbackRows: 5000 },
    read: { chunkBytes: 65536, readerCredits: 65536, readers: 4 },
    frame: { bytes: 16777216, inFlight: 1 },
    receipts: 4096,
  },
  host: { bindings: 4096, custodyReceipts: 4096, tombstones: 4096 },
  usage: { periodMs: 1200 },
});

export const BENCH_LIMITS = {
  frameBytes: 16793604,
  headerBytes: 16384,
  connections: 6,
  requests: 6,
  subscriptions: 3296,
  credits: 16793604,
  helloMs: 5000,
} as WireLimits;

export const benchBoot = (directory: string): string => {
  const boot = join(directory, 'boot.json');
  writeFileSync(
    boot,
    Schema.encodeSync(Schema.fromJsonString(HostBoot))({
      state: directory,
      registration: registrationOf(directory),
      library: HOLDER_LIBRARY,
      policy: BENCH_POLICY,
      share: 0.25,
      limits: BENCH_LIMITS,
      lifetime: 'with-parent',
    }),
    { mode: 0o600 },
  );
  return boot;
};

const takeHost = Effect.fnUntraced(
  function* (executions: HostAuthority['Service']) {
    const first = yield* executions.take(keyOf('bench-take'), 0);
    if (first._tag !== 'Stale') return first;
    return yield* executions.take(keyOf('bench-take-standing'), first.standing.revision);
  },
  Effect.retry(Schedule.upTo(Schedule.spaced(Duration.millis(25)), { duration: Duration.seconds(10) })),
);

export const benchClient = Effect.fnUntraced(function* (directory: string) {
  const registration = registrationOf(directory);
  const executions = yield* ExecutionClient.make({
    address: { state: registration.state, installation: registration.installation },
    role: 'custodian',
    limits: BENCH_LIMITS,
    budget: { handshakeMs: 5_000 },
  }).pipe(Effect.retry(Schedule.upTo(Schedule.spaced(Duration.millis(50)), { duration: Duration.seconds(15) })));
  yield* takeHost(executions);
  return executions;
});
