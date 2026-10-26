import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, type Scope } from 'effect';
import type { ThreadRow, ThreadRunRow } from '../rows';
import type { ThreadBorderFailed } from '../ThreadBorder';
import type { Transport } from '../transport/contract';
import { silentGuidance } from './fakeTransport';
export type TransportRunStart = {
  readonly thread: ThreadRow;
  readonly run: ThreadRunRow;
};

export type RunsHarness = {
  readonly transport: Transport;
  start(): Effect.Effect<TransportRunStart, ThreadBorderFailed>;
  sent(): number;
};
const GHOST = {
  id: 'ghost-run',
  threadId: 'ghost-thread',
  kind: 'turn',
  gapMs: 0,
  selector: { kind: 'handed-over' },
  resumeLimit: 1,
  stopRequest: null,
} as const;
export function describeTransportRuns<R>(
  name: string,
  make: () => Effect.Effect<RunsHarness, unknown, Scope.Scope | R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: the runs an adapter executes`, () => {
    test(
      'a run the core handed over is held at once, and handing it over again sends nothing more',
      Effect.fnUntraced(function* () {
        const harness = yield* make();
        const { thread, run } = yield* harness.start();
        const { runs } = harness.transport;
        expect(runs.holds([run.id, 'ghost-run'])).toEqual([run.id]);
        const sent = harness.sent();
        yield* runs.launch({ thread, run, oriented: true, outputOptional: false, seed: [], guidance: silentGuidance });
        yield* runs.launch({ thread, run, oriented: true, outputOptional: false, seed: [], guidance: silentGuidance });
        expect(runs.holds([run.id])).toEqual([run.id]);
        expect(harness.sent()).toBe(sent);
      }),
    );
    test(
      'a run the adapter never held is declined on adoption and held by no one',
      Effect.fnUntraced(function* () {
        const harness = yield* make();
        expect(yield* harness.transport.runs.adopt(GHOST)).toBe('declined');
        expect(harness.transport.runs.holds([GHOST.id])).toEqual([]);
      }),
    );
  });
}
