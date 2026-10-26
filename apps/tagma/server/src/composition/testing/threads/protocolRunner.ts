import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Effect } from 'effect';
import { fixtureRunner } from '../../../external-harnesses/testing/claudeRunner.js';
import { door as cliDoor } from '../../cli/doorBinding.js';

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
