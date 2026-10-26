import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { releaseCommand } from '../../installation/cut/pipeline.js';
import { notarizeCommand, publishCommand } from '../../installation/cut/publish.js';
import { CUT } from '../release/cut.js';
import { CHANNEL as DEVELOPER } from '../developer/channel.js';
import { STEPS as steps } from './steps.js';

const given = process.argv.slice(2);
const server = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const verbs = {
  publish: () => publishCommand(server, given.slice(1), DEVELOPER),
  notarize: () => notarizeCommand(server, given.slice(1), DEVELOPER),
};
const verb = given[0] === 'publish' || given[0] === 'notarize' ? given[0] : null;
const cut = given.filter((one) => one !== '--notarize');
const out = cut.flatMap((one, at) => (one === '--json' ? [one] : one === '--out' ? [one, cut[at + 1] ?? ''] : []));
const command =
  verb !== null
    ? verbs[verb]()
    : cut.length === given.length
      ? releaseCommand(server, given, CUT, steps, DEVELOPER)
      : Effect.andThen(releaseCommand(server, cut, CUT, steps, DEVELOPER), notarizeCommand(server, out, DEVELOPER));

const halted = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => halted.abort());
await Effect.runPromise(command, { signal: halted.signal }).catch((cause: unknown) => {
  if (!halted.signal.aborted) throw cause;
  console.error('[tagma] stopped');
  process.exit(143);
});
