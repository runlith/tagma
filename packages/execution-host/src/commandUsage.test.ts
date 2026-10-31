import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { ExecutionId, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import type { UsageReading } from '@runlith/executions/protocol/evidence';
import type { CommandEntry } from '@runlith/executions/protocol/inventory';
import type { ProcessUsage } from './ProcessUsage';
import { measuredRows } from './commandUsage';

const ref: ExecutionRef = { installation: InstallationId.make('installation-1'), execution: ExecutionId.make('command-1'), incarnation: 1 };
const namespace = { _tag: 'Local', machine: 'machine-1' } as const;
const scope = { host: namespace, network: namespace };

const entry = (phase: 'ended' | 'running'): CommandEntry => ({
  admission: { origin: { scope: 'thread', owner: 'agent', cohort: 'turn' }, limits: {}, policyIdentity: 'policy' },
  state: {
    ref,
    phase,
    transport: 'pipes',
    lifetime: 'command',
    purpose: 'command',
    streams: { stdout: phase === 'ended' ? 'eof' : 'open', stderr: phase === 'ended' ? 'eof' : 'open', pty: 'eof' },
    cleanup: phase === 'ended' ? 'complete' : 'pending',
    record: 'available',
  },
  admittedAtMs: 1_000,
  deadline: { execution: ref, revision: 0, origin: 'caller', elapsedMs: 700 },
  ending:
    phase === 'ended'
      ? {
          execution: ref,
          cost: { _tag: 'Measured', cpuMicros: 350_000, peakRssBytes: 1024 },
          coverage: ['leader'],
          relation: 'leader',
          confirmed: [],
          residual: [],
          unverifiable: [],
          streams: [],
          cleanup: 'complete',
          retention: 'retained',
          abandonedOutput: false,
        }
      : undefined,
});

const unused = Effect.die('command inventory only reads the latest usage');
const usageOf = (latest: UsageReading | undefined): ProcessUsage => ({
  scope,
  latest: () => Effect.succeed(latest),
  all: () => unused,
  sampled: () => unused,
  load: unused,
  subscribe: () => unused,
  interest: () => unused,
  parts: () => unused,
  sample: () => unused,
  refresh: () => unused,
  sampling: unused,
});

const sampled: UsageReading = {
  scope,
  execution: ref,
  source: { adapter: 'native', probe: 'process' },
  observedAt: 1_700,
  revision: 1,
  takenAtMicros: 700_000,
  completeness: 'partial',
  unmeasured: [],
  coverage: ['leader'],
  processes: [],
  cpu: { _tag: 'Unknown', reason: 'first-sample', detail: 'the first sample has no interval' },
  memory: { _tag: 'ResidentSum', bytes: 2048, processes: 1 },
};

describe('what a command shorter than a step reports', () => {
  it.effect(
    'reports the lifetime average of its ending, over its own elapsed time, with no invented memory',
    Effect.fnUntraced(function* () {
      const answered = yield* measuredRows([entry('ended')], usageOf(undefined));
      const reading = answered.commands[0]?.usage;
      expect(reading?.cpu).toMatchObject({ _tag: 'Measured', cores: 0.5, basis: 'lifetime' });
      expect(reading?.memory).toMatchObject({ _tag: 'Unknown' });
      expect(reading?.completeness).toBe('partial');
    }),
  );

  it.effect(
    'leaves a command that is still running to what the sampler last measured',
    Effect.fnUntraced(function* () {
      const answered = yield* measuredRows([entry('running')], usageOf(sampled));
      expect(answered.commands[0]?.usage).toEqual(sampled);
    }),
  );

  it.effect(
    'says the host measures nothing when it has no usage owner',
    Effect.fnUntraced(function* () {
      const running = entry('running');
      const answered = yield* measuredRows([running], undefined);
      expect(answered.commands).toEqual([running]);
      expect(answered.unmeasured.length).toBeGreaterThan(0);
    }),
  );
});
