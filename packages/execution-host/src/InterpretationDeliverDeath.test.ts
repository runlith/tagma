import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Duration, Effect, Metric, Schedule } from 'effect';
import { Schema } from 'effect';
import { CapabilityProfile } from '@runlith/executions/protocol/capacity';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { offsetValue } from '@runlith/executions/protocol/record';
import { fiberDeaths } from './hostTelemetry';
import { makeInterpretation } from './Interpretation';
import { makePresentation } from './Presentation';
import { runtimeProfile } from './runtimeFixture';

const decodeRef = Schema.decodeUnknownSync(ExecutionRef);
const decodeProfile = Schema.decodeUnknownSync(CapabilityProfile);
const ref = decodeRef({ installation: 'installation-1', execution: 'execution-1', incarnation: 0 });
const COLORS = {
  palette: Array.from({ length: 256 }, (_, index) => index * 0x010101),
  foreground: 0xe5e5e5,
  background: 0x000000,
  cursor: 0xe5e5e5,
};
const bytes = (text: string) => new TextEncoder().encode(text);
const geometryOf = (profile: ReturnType<typeof runtimeProfile>) => ({
  rows: profile.execution.geometry.rows,
  columns: profile.execution.geometry.columns,
});
const profileWith = (): CapabilityProfile => {
  const base = runtimeProfile();
  const geometry = base.execution.geometry;
  const lines = geometry.rows + geometry.scrollbackRows + geometry.rows;
  const cells = lines * geometry.columns;
  const cellBytes = 2 * cells * 12 + cells * 2 * 84;
  return decodeProfile({
    ...base,
    execution: { ...base.execution, parser: { ...base.execution.parser, cellBytes } },
  });
};
describe('interpreter delivery death', () => {
  it.live(
    'a defect on the reply road names the screen gone, with the frontier it was true through',
    Effect.fnUntraced(
      function* () {
        const profile = profileWith();
        const interpretation = yield* makeInterpretation({
          mode: 'open',
          ref,
          geometry: geometryOf(profile),
          limits: profile.execution,
          colors: COLORS,
          reply: () => Effect.die(new Error('reply sink defect')),
        });
        const through = yield* interpretation.feed(bytes('hello'));
        yield* interpretation.feed(bytes('\u001b[c'));
        const outcome = yield* Effect.all({
          failed: interpretation.unavailable,
          deaths: Metric.value(Metric.withAttributes(fiberDeaths, { fiber: 'interpretation-deliver' })),
        }).pipe(
          Effect.repeat({
            while: ({ failed, deaths }) => failed === undefined || deaths.count === 0,
            schedule: Schedule.spaced(Duration.millis(1)),
          }),
        );
        const fed = yield* Effect.flip(interpretation.feed(bytes('more')));
        const read = yield* Effect.flip(interpretation.read((engine) => engine.rows));
        const presentation = yield* makePresentation({ interpretation, limits: profile.execution, ref });
        const frame = yield* presentation.update();
        const again = yield* presentation.update();
        expect(outcome.failed?.reason).toBe('engine');
        expect(offsetValue(outcome.failed!.parsedThrough)).toBe(offsetValue(through));
        expect(outcome.failed?.detail).toContain('reply sink defect');
        expect(fed.reason).toBe('engine');
        expect(read.reason).toBe('engine');
        expect(outcome.deaths.count).toBe(1);
        expect(frame._tag).toBe('ScreenUnavailable');
        if (frame._tag === 'ScreenUnavailable') {
          expect(frame.reason).toBe('engine');
          expect(offsetValue(frame.parsedThrough)).toBe(offsetValue(through));
        }
        expect(again._tag).toBe('ScreenUnavailable');
        if (again._tag === 'ScreenUnavailable') expect(again.reason).toBe('engine');
      },
      (effect) => Effect.provideService(effect, Metric.MetricRegistry, new Map()),
    ),
  );
});
