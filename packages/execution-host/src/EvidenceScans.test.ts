import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Deferred, Duration, Effect, Fiber, Ref, Result } from 'effect';
import { TestClock } from 'effect/testing';
import type { EvidenceNamespace, ProcessSnapshot } from '@runlith/executions/protocol/evidence';
import { EvidenceReader, type EvidenceProbe, type Measured, type ScanLimits, makeEvidenceScans } from './EvidenceScans';

const machine: EvidenceNamespace = { _tag: 'Local', machine: 'scans-test' };
const scope = { host: machine, network: machine };
const source = { adapter: 'test', probe: 'rows' };

const row = (pid: number, observedAt: number): ProcessSnapshot => ({
  scope,
  source,
  observedAt,
  completeness: 'complete',
  unmeasured: [],
  identity: { pid },
});

type Probe = {
  readonly probe: EvidenceProbe;
  readonly peak: Ref.Ref<number>;
  readonly entered: Deferred.Deferred<void>;
};

const probeOf = Effect.fnUntraced(function* (rows: number, held: Deferred.Deferred<void> | undefined): Effect.fn.Return<Probe> {
  const live = yield* Ref.make(0);
  const peak = yield* Ref.make(0);
  const entered = yield* Deferred.make<void>();
  const processes = () =>
    Effect.acquireUseRelease(
      Ref.modify(live, (count) => [count + 1, count + 1] as const),
      (inside) =>
        Effect.gen(function* () {
          yield* Ref.update(peak, (most) => (inside > most ? inside : most));
          yield* Deferred.succeed(entered, undefined);
          if (held !== undefined) yield* Deferred.await(held);
          const observedAt = yield* Clock.currentTimeMillis;
          return {
            observedAt,
            completeness: 'complete',
            unmeasured: [],
            found: Array.from({ length: rows }, (_, index) => row(index + 1, observedAt)),
          } satisfies Measured<ProcessSnapshot>;
        }),
      () => Ref.update(live, (count) => count - 1),
    );
  return {
    peak,
    entered,
    probe: {
      scope,
      processes,
      listeners: () => Effect.die('this case measures processes alone'),
    },
  };
});

const LIMITS: ScanLimits = { concurrency: 2, flight: 4, freshMs: 0, retained: 4, results: 8 };

describe('EvidenceScans', () => {
  it.effect('answers callers that arrive during one run from that run, and measures a different question on its own', () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const held = yield* probeOf(1, gate);
      const scans = yield* makeEvidenceScans({ limits: LIMITS }).pipe(Effect.provideService(EvidenceReader, held.probe));
      const asked = { _tag: 'Pids', pids: [7] } as const;
      const [first, second] = yield* Effect.all(
        [
          scans.processes(asked),
          scans.processes({ _tag: 'Pids', pids: [7, 7] }),
          Effect.andThen(Deferred.await(held.entered), Deferred.succeed(gate, undefined)),
        ],
        { concurrency: 3 },
      );
      expect(first.revision).toBe(1);
      expect(second.revision).toBe(1);

      const other = yield* scans.processes({ _tag: 'Terminal', terminal: 'ttys999' });
      expect(other.revision).toBe(2);
    }),
  );

  it.effect('runs no more probes at once than its ceiling allows', () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const held = yield* probeOf(1, gate);
      const scans = yield* makeEvidenceScans({ limits: { ...LIMITS, concurrency: 1 } }).pipe(
        Effect.provideService(EvidenceReader, held.probe),
      );
      yield* Effect.all(
        [
          scans.processes({ _tag: 'Pids', pids: [1] }),
          scans.processes({ _tag: 'Pids', pids: [2] }),
          Effect.andThen(Deferred.await(held.entered), Deferred.succeed(gate, undefined)),
        ],
        { concurrency: 3 },
      );
      expect(yield* Ref.get(held.peak)).toBe(1);
    }),
  );

  it.effect('refuses a question once it holds as many open measurements as it will, and says nobody looked', () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const held = yield* probeOf(1, gate);
      const scans = yield* makeEvidenceScans({ limits: { ...LIMITS, flight: 1 } }).pipe(Effect.provideService(EvidenceReader, held.probe));
      const [, crowded] = yield* Effect.all(
        [
          scans.processes({ _tag: 'Pids', pids: [1] }),
          scans.processes({ _tag: 'Pids', pids: [2] }),
          Effect.andThen(Deferred.await(held.entered), Deferred.succeed(gate, undefined)),
        ],
        { concurrency: 3 },
      );
      expect(crowded.completeness).toBe('unavailable');
      expect(crowded.found).toEqual([]);
      expect(crowded.revision).toBe(0);
      expect(crowded.unmeasured.map((region) => region.reason)).toEqual(['refused']);
    }),
  );

  it.effect('leaves a question askable after the caller that owned its run walked away', () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const held = yield* probeOf(1, gate);
      const scans = yield* makeEvidenceScans({ limits: LIMITS }).pipe(Effect.provideService(EvidenceReader, held.probe));
      const asked = { _tag: 'Pids', pids: [3] } as const;
      const owner = yield* Effect.forkChild(scans.processes(asked));
      yield* Deferred.await(held.entered);
      const leaving = yield* Effect.forkChild(Fiber.interrupt(owner));
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(leaving);
      const after = yield* scans.processes(asked);
      expect(after.found.length).toBe(1);
    }),
  );

  it.effect('gives a hung reading its place back when that reading gives up', () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      const wedged: EvidenceProbe = {
        scope,
        processes: (request) =>
          request._tag === 'Pids' && request.pids[0] === 1
            ? Effect.gen(function* () {
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(released);
                return {
                  observedAt: yield* Clock.currentTimeMillis,
                  completeness: 'unavailable' as const,
                  unmeasured: [
                    { region: 'the processes 1', reason: 'timeout' as const, detail: 'the probe gave up waiting for its source' },
                  ],
                  found: [],
                };
              })
            : Effect.map(Clock.currentTimeMillis, (observedAt) => ({
                observedAt,
                completeness: 'complete' as const,
                unmeasured: [],
                found: [row(2, observedAt)],
              })),
        listeners: () => Effect.die('this case measures processes alone'),
      };
      const scans = yield* makeEvidenceScans({ limits: { ...LIMITS, concurrency: 1 } }).pipe(Effect.provideService(EvidenceReader, wedged));
      const hung = yield* Effect.forkChild(scans.processes({ _tag: 'Pids', pids: [1] }));
      yield* Deferred.await(entered);
      yield* Deferred.succeed(released, undefined);
      const given = yield* Fiber.join(hung);
      expect(given.completeness).toBe('unavailable');
      const after = yield* scans.processes({ _tag: 'Pids', pids: [2] });
      expect(after.found.length).toBe(1);
    }),
  );

  it.effect('refuses figures it could never measure with, at the moment it is built', () =>
    Effect.gen(function* () {
      const held = yield* probeOf(1, undefined);
      const refusal = yield* Effect.result(
        makeEvidenceScans({ limits: { ...LIMITS, concurrency: 0 } }).pipe(Effect.provideService(EvidenceReader, held.probe)),
      );
      expect(Result.isFailure(refusal) && refusal.failure._tag).toBe('ScanLimitsRefused');
    }),
  );

  it.effect('serves a completed measurement again inside its window and measures again once the window passes', () =>
    Effect.gen(function* () {
      const held = yield* probeOf(1, undefined);
      const scans = yield* makeEvidenceScans({ limits: { ...LIMITS, freshMs: 500 } }).pipe(
        Effect.provideService(EvidenceReader, held.probe),
      );
      const asked = { _tag: 'Pids', pids: [11] } as const;
      const first = yield* scans.processes(asked);
      yield* TestClock.adjust(Duration.millis(499));
      const inside = yield* scans.processes(asked);
      yield* TestClock.adjust(Duration.millis(2));
      const after = yield* scans.processes(asked);
      expect([first.revision, inside.revision, after.revision]).toEqual([1, 1, 2]);
    }),
  );

  it.effect('cuts an answer larger than its bound and says the rows past it were not answered', () =>
    Effect.gen(function* () {
      const held = yield* probeOf(5, undefined);
      const scans = yield* makeEvidenceScans({ limits: { ...LIMITS, results: 3 } }).pipe(Effect.provideService(EvidenceReader, held.probe));
      const scan = yield* scans.processes({ _tag: 'Pids', pids: [1] });
      expect(scan.found.length).toBe(3);
      expect(scan.completeness).toBe('partial');
      expect(scan.unmeasured.map((region) => region.reason)).toEqual(['truncated']);
    }),
  );

  it.effect('retains no more measurements than its bound, and measures an evicted question again', () =>
    Effect.gen(function* () {
      const held = yield* probeOf(1, undefined);
      const scans = yield* makeEvidenceScans({ limits: { ...LIMITS, freshMs: 500, retained: 1 } }).pipe(
        Effect.provideService(EvidenceReader, held.probe),
      );
      const first = yield* scans.processes({ _tag: 'Pids', pids: [1] });
      yield* scans.processes({ _tag: 'Pids', pids: [2] });
      const again = yield* scans.processes({ _tag: 'Pids', pids: [1] });
      expect(first.revision).toBe(1);
      expect(again.revision).toBe(3);
    }),
  );
});
