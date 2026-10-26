import { Effect, Layer } from 'effect';
import {
  type InterruptReceipt,
  LaunchFailed,
  type LaunchGuidance,
  type RunLaunch,
  type Transport,
  type TransportDeclaration,
  type Withdrawal,
} from '../transport/contract';
import type { ThreadInboxItem } from '../storage/inbox';
import { ThreadRunStopped } from '../run/RunExecution';
import { Transports, transportsLayer } from '../transport/Transports';

export type FakeEngine = {
  holds(runId: string): boolean;
  abort(runId: string, reason: Error): Effect.Effect<InterruptReceipt>;
};

export const silentGuidance: LaunchGuidance = {
  prompt: () => Effect.succeed({ texts: [], tail: null, events: [], delivered: Effect.void }),
  notes: () => Effect.succeed(null),
  reset: () => undefined,
};

export type FakeAdapter = {
  readonly transport: Transport;
  readonly launches: RunLaunch[];
  readonly held: Set<string>;
  readonly interrupted: string[];
  readonly queued: string[];
  readonly delivered: { readonly runId: string; readonly items: readonly ThreadInboxItem[] }[];
  withdrawal: Withdrawal;
  refusing: boolean;
  bind(engine: FakeEngine): void;
};

export function fakeAdapter(
  adapter = 'native',
  declares: TransportDeclaration = { history: 'none', compaction: 'none' },
  subjects: Partial<Transport> = {},
): FakeAdapter {
  let engine: FakeEngine | null = null;
  const fake: FakeAdapter = {
    launches: [],
    held: new Set(),
    interrupted: [],
    queued: [],
    delivered: [],
    withdrawal: 'unsent',
    refusing: false,
    bind: (given) => {
      engine = given;
    },
    transport: {
      adapter,
      declares,
      words: 'opening',
      runs: {
        launch: (launch) =>
          Effect.suspend(() => {
            if (fake.held.has(launch.run.id)) return Effect.void;
            fake.held.add(launch.run.id);
            fake.launches.push(launch);
            return fake.refusing ? Effect.fail(new LaunchFailed({ reason: 'the CLI is unreachable' })) : Effect.void;
          }),
        deliver: (run, items) => Effect.sync(() => void fake.delivered.push({ runId: run.id, items })),
        withdraw: () => Effect.sync(() => fake.withdrawal),
        queued: (run) => Effect.sync(() => void fake.queued.push(run.id)),
        holds: (runIds) => runIds.filter((runId) => fake.held.has(runId) || engine?.holds(runId) === true),
        interrupt: (runId, by) =>
          Effect.suspend(() => {
            fake.interrupted.push(runId);
            const held = fake.held.has(runId);
            const aborted = engine === null ? Effect.succeed<InterruptReceipt>('no-turn') : engine.abort(runId, new ThreadRunStopped(by));
            return Effect.map(aborted, (receipt): InterruptReceipt => (held ? 'interrupted' : receipt));
          }),
        adopt: () => Effect.succeed('declined'),
        reached: () => Effect.void,
      },
      ...subjects,
    },
  };
  return fake;
}

export function transportsOver(...adapters: readonly FakeAdapter[]): Layer.Layer<Transports> {
  return Layer.effect(
    Transports,
    Effect.gen(function* () {
      const transports = yield* Transports;
      for (const adapter of adapters) yield* Effect.orDie(transports.register(adapter.transport));
      return transports;
    }),
  ).pipe(Layer.provide(transportsLayer));
}
