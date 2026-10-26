import { Clock, Effect } from 'effect';
import type { UsageReading } from '@runlith/executions/protocol/evidence';
import type { CommandEntry, CommandPage, UnmeasuredCoverage } from '@runlith/executions/protocol/inventory';
import type { ProcessUsage } from './ProcessUsage';

export type CommandMeasurement = {
  readonly commands: readonly CommandEntry[];
  readonly unmeasured: readonly UnmeasuredCoverage[];
};

export const measuredRows = (rows: ReadonlyArray<CommandEntry>, usage: ProcessUsage | undefined): Effect.Effect<CommandMeasurement> =>
  usage === undefined
    ? Effect.succeed({
        commands: rows,
        unmeasured: [
          {
            region: 'the live cost of every command in this answer',
            detail: 'this host measures no live usage: the installation declared no usage policy, so nothing is sampled',
          },
        ],
      })
    : Effect.map(
        Effect.forEach(rows, (entry) =>
          Effect.gen(function* () {
            const latest = yield* usage.latest(entry.state.ref.execution);
            const cost = entry.ending?.cost;
            const elapsed = entry.deadline.elapsedMs;
            if (entry.state.phase !== 'ended' || cost?._tag !== 'Measured' || elapsed === undefined || elapsed <= 0)
              return latest === undefined ? entry : { ...entry, usage: latest };
            const takenAtMicros = Number((yield* Clock.monotonicTimeNanos) / 1000n);
            const reading: UsageReading = {
              scope: usage.scope,
              source: { adapter: 'reap', probe: 'lifetime' },
              observedAt: entry.admittedAtMs + elapsed,
              revision: 0,
              takenAtMicros,
              execution: entry.state.ref,
              completeness: 'partial',
              unmeasured: [
                {
                  region: 'processes not waited for by the command',
                  reason: 'unknown',
                  detail: 'the reap accounts for the leader and descendants it waited for; it does not account for orphans left running',
                },
              ],
              coverage: ['leader'],
              processes: [],
              cpu: {
                _tag: 'Measured',
                cores: cost.cpuMicros / (elapsed * 1000),
                overMicros: elapsed * 1000,
                population: { matched: 1, born: 0, departed: 0 },
                basis: 'lifetime',
                completeness: 'partial',
                gaps: [],
                detail: 'average over the command lifetime: leader and descendants it waited for; orphans left running are excluded',
              },
              memory: { _tag: 'Unknown', reason: 'unknown', detail: 'the reap carries peak resident memory, not a live footprint' },
            };
            return { ...entry, usage: reading };
          }),
        ),
        (commands) => ({ commands, unmeasured: [] }),
      );

const REGISTRY_USAGE_REGION = 'the live cost of these commands';

export const measuredPage = (page: CommandPage, usage: ProcessUsage | undefined): Effect.Effect<CommandPage> =>
  Effect.map(measuredRows(page.commands, usage), (measured) => ({
    ...page,
    commands: measured.commands,
    unmeasured: [
      ...(usage === undefined ? page.unmeasured : page.unmeasured.filter((region) => region.region !== REGISTRY_USAGE_REGION)),
      ...measured.unmeasured,
    ],
  }));
