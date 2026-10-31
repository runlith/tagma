import { Effect } from 'effect';
import { doorOf } from '../cli/door.js';
import { CurrentInvocation } from '../../platform/cli/verb.js';
import { build } from '../../installation/cut/build.js';
import { DEVELOPER } from '../developer/build.js';
import { readRemoteStartup } from '../../installation/process/serverStart.js';

const door = doorOf(DEVELOPER.channel);

const cut = build(
  {
    ask: door.ask,
    baseUrl: door.baseUrl,
    boundHere: door.boundHere,
    healthOrNone: door.healthOrNone,
    startup: () => Effect.flatMap(CurrentInvocation, (at) => readRemoteStartup(door.baseUrl(at))),
  },
  process.argv.slice(2),
  DEVELOPER.cut,
);

const halted = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => halted.abort());
await Effect.runPromise(cut, { signal: halted.signal }).catch((cause: unknown) => {
  if (!halted.signal.aborted) throw cause;
  console.error('[tagma] stopped');
  process.exit(143);
});
