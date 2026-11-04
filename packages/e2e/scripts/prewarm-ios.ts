import { Cause, Effect, Exit } from 'effect';
import { appendFileSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureFailure, record, type FailureArtifact } from '../src/artifacts';
import { prewarm } from '../src/lanes/simulator';

const runtimes = (process.env.E2E_IOS_RUNTIMES ?? '26').split(',');
if (runtimes.length !== 1) throw new Error(`E2E_IOS_DEVICE names one device, so prepare one runtime, not ${runtimes.join(', ')}`);
const directory = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'ios-lane-device-'));
const recording = { directory, failures: new Set<FailureArtifact>() };
const exit = await record(recording, () =>
  Effect.runPromiseExit(
    Effect.scoped(
      prewarm({ runtime: runtimes[0]!, deviceType: process.env.E2E_IOS_DEVICE_TYPE }).pipe(
        Effect.tapCause(() =>
          Effect.promise(() => captureFailure().catch((cause) => console.error('iOS lane device evidence was incomplete', cause))),
        ),
      ),
    ),
  ),
);
if (Exit.isFailure(exit)) {
  console.error(Cause.pretty(exit.cause));
  for (const name of readdirSync(directory).filter((one) => one.endsWith('.json') || one.endsWith('.log')))
    console.error(`--- ${name}\n${readFileSync(join(directory, name), 'utf8')}`);
  process.exit(1);
}
const line = `E2E_IOS_DEVICE=${exit.value.device.udid}`;
if (process.env.GITHUB_ENV === undefined) console.info(line);
else appendFileSync(process.env.GITHUB_ENV, `${line}\n`);
console.info(`iOS lane device ${exit.value.device.udid} is booted and Safari has launched once`);
