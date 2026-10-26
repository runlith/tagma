import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { transitionCommand } from '../../installation/cut/transition.js';
import { CUT } from '../release/cut.js';
import { CHANNEL as DEVELOPER } from '../developer/channel.js';
import { STEPS } from './steps.js';

const server = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

const halted = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => halted.abort());
await Effect.runPromise(transitionCommand(server, process.argv.slice(2), CUT, STEPS, DEVELOPER), { signal: halted.signal }).catch(
  (cause: unknown) => {
    if (!halted.signal.aborted) throw cause;
    console.error('[tagma] stopped');
    process.exit(143);
  },
);
