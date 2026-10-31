import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Effect } from 'effect';
import { fixtureRunner } from '../../../external-harnesses/testing/claudeRunner.js';
import { doorFor } from '../../cli/doorBinding.js';
import { DEVELOPER } from '../../developer/build.js';

const cliDoor = doorFor(DEVELOPER.channel);

const at = process.argv.indexOf('--report');
const report = at < 0 ? undefined : process.argv[at + 1];
if (report === undefined) {
  process.stderr.write('protocolRunner needs --report <path>\n');
  process.exit(2);
}

BunRuntime.runMain(
  Effect.gen(function* () {
    const server = process.argv.includes('--server-door') ? yield* Effect.promise(cliDoor) : undefined;
    yield* fixtureRunner({ report, server });
  }),
);
