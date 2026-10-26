import { Effect, Schema } from 'effect';
import { CapabilityProfile } from '@runlith/executions/protocol/capacity';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { makeInterpretation } from './Interpretation';
import { runtimeProfile } from './runtimeFixture';

const option = (name: string, fallback: number) =>
  Number(process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback);
const checkpoints = option('checkpoints', 4);
const tickMs = option('tick', 2);
const bursts = option('bursts', 0);
const retainedMiB = option('retained', 8);
const styled = process.argv.includes('--styled');

const geometry = { rows: 100, columns: 320 };
const base = runtimeProfile({ ...geometry, scrollbackRows: 5000 });
const cells = (geometry.rows * 2 + 5000) * geometry.columns;
const limits = Schema.decodeUnknownSync(CapabilityProfile)({
  ...base,
  execution: {
    ...base.execution,
    output: { landingBytes: 16384, segmentBytes: 262144, retainedBytes: retainedMiB * 1024 * 1024 },
    parser: { ...base.execution.parser, cellBytes: 2 * cells * 12 + cells * 168 },
  },
}).execution;
const COLORS = {
  palette: Array.from({ length: 256 }, (_, index) => index * 0x010101),
  foreground: 0xe5e5e5,
  background: 0,
  cursor: 0xe5e5e5,
};
const ref = (execution: string) => Schema.decodeUnknownSync(ExecutionRef)({ installation: 'bench', execution, incarnation: 0 });
const silent = () => Effect.succeed({ delivered: true, ending: false, detail: '' });

const line = styled
  ? `${Array.from({ length: 40 }, (_, index) => `\u001b[3${index % 8};4${(index + 3) % 8}mabcdefg`).join('')}\u001b[0m\r\n`
  : `${'lorem ipsum dolor sit amet '.repeat(12).slice(0, 300)}\r\n`;
const slice = new TextEncoder().encode(line.repeat(Math.floor(16384 / line.length)));

const percentile = (values: ReadonlyArray<number>, share: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
};

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const flood = yield* makeInterpretation({ mode: 'open', ref: ref('flood'), geometry, limits, colors: COLORS, reply: silent });
      const echo = yield* makeInterpretation({ mode: 'open', ref: ref('echo'), geometry, limits, colors: COLORS, reply: silent });
      const latencies: number[] = [];
      const windows: Array<{ readonly from: number; readonly to: number }> = [];
      let running = true;
      const probe = (async () => {
        while (running) {
          const due = performance.now() + tickMs;
          await new Promise((resolve) => setTimeout(resolve, tickMs));
          await Effect.runPromise(echo.feed(new Uint8Array([0x78])));
          latencies.push(performance.now() - due);
        }
      })();
      let taken = 0;
      let parsed = 0;
      const started = performance.now();
      while (taken < checkpoints || parsed < bursts * slice.length) {
        const before = performance.now();
        const burst = yield* flood.burst(slice);
        parsed += slice.length;
        if (burst.checkpoint !== undefined) {
          taken += 1;
          windows.push({ from: before, to: performance.now() });
        }
        yield* Effect.promise(() => new Promise((resolve) => setImmediate(resolve)));
      }
      running = false;
      yield* Effect.promise(() => probe);
      const elapsed = performance.now() - started;
      const stalls = windows.map((window) => window.to - window.from);
      console.log(
        JSON.stringify({
          styled,
          checkpoints: taken,
          parsedMiB: +(parsed / 1048576).toFixed(1),
          elapsedMs: Math.round(elapsed),
          burstWithCheckpointMs: stalls.map((ms) => +ms.toFixed(1)),
          echoLatencyMs: {
            p50: +percentile(latencies, 0.5).toFixed(1),
            p99: +percentile(latencies, 0.99).toFixed(1),
            max: +Math.max(...latencies).toFixed(1),
            samples: latencies.length,
          },
        }),
      );
    }),
  ),
);
