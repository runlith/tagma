import { arch, cpus, platform, release, totalmem } from 'node:os';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Effect } from 'effect';
import { LAG_LENGTHS, standInRestartedPlace } from './restartProbe.js';

const lengthsArgument = Bun.argv.find((argument) => argument.startsWith('--messages='));
const lengths = lengthsArgument
  ? lengthsArgument
      .slice('--messages='.length)
      .split(',')
      .map((part) => Number.parseInt(part, 10))
  : [LAG_LENGTHS.small, LAG_LENGTHS.big];
if (lengths.some((length) => !Number.isSafeInteger(length) || length <= 0)) throw new Error('--messages must list positive integers');

const main = Effect.gen(function* () {
  const readings = [];
  for (const messages of lengths) {
    const sample = yield* standInRestartedPlace(messages);
    readings.push({
      messages,
      frameMs: Math.round(sample.frameMs),
      windowMs: Math.round(sample.windowMs),
      acceptedMs: Math.round(sample.acceptedMs),
      serverMs: sample.serverMs === null ? null : Math.round(sample.serverMs),
      frameEntries: sample.transcript.length,
    });
  }
  console.log(
    JSON.stringify(
      {
        machine: {
          platform: platform(),
          release: release(),
          arch: arch(),
          cpu: cpus()[0]?.model,
          cores: cpus().length,
          memoryGb: Math.round(totalmem() / 2 ** 30),
        },
        dataset: 'offloaded threads, message entries of about 230 bytes, 4 threads in 2 projects, only the first thread differs in length',
        readings,
      },
      null,
      2,
    ),
  );
});

BunRuntime.runMain(main);
