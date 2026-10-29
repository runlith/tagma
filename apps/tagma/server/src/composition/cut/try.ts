import { Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { door } from '../cli/door.js';
import { claimHoldersLayer } from '../hostClaims.js';
import { ClaimHolders } from '../../executions/contract/service/host.js';
import { tryout } from '../../installation/cut/try.js';
import type { InstanceHosts } from '../../installation/cut/port.js';
import { hostsStaying } from '../../executions/host/staying.js';
import { HARNESSES } from '../../external-harnesses/contract/service/table.js';
import { CUT as DEVELOPER } from '../developer/cut.js';
import { CUT as RELEASE } from '../release/cut.js';
import { CurrentInvocation } from '../../platform/cli/verb.js';
import { readRemoteStartup } from '../../installation/process/serverStart.js';

const halted = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(signal, () => halted.abort());

const hosts: InstanceHosts = {
  staying: (database) =>
    Effect.flatMap(Effect.all([ClaimHolders, FileSystem.FileSystem]), ([holders, files]) => hostsStaying(holders, files, database)).pipe(
      Effect.map((staying) =>
        staying.map(({ state, claim }) => ({
          state,
          holders: claim._tag === 'Held' ? claim.holders : [],
          detail: claim._tag === 'Unmeasured' ? claim.detail : null,
        })),
      ),
      Effect.provide(Layer.merge(BunFileSystem.layer, claimHoldersLayer)),
    ),
};

await Effect.runPromise(
  tryout(
    {
      baseUrl: door.baseUrl,
      healthOrNone: door.healthOrNone,
      startup: () => Effect.flatMap(CurrentInvocation, (at) => readRemoteStartup(door.baseUrl(at))),
    },
    hosts,
    process.argv.slice(2).filter((argument) => argument !== '--release'),
    HARNESSES.flatMap(({ variable }) => (variable === undefined ? [] : [variable])),
    process.argv.includes('--release') ? RELEASE : DEVELOPER,
  ),
  { signal: halted.signal },
).catch((cause: unknown) => {
  if (!halted.signal.aborted) throw cause;
  console.error('[tagma] stopped');
  process.exit(143);
});
