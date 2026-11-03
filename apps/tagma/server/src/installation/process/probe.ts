import { join } from 'node:path';
import { Data, Effect } from 'effect';
import { Processes } from '@runlith/execution-host/ProcessReader';
import { dataDirectoryLocked } from '../../platform/lock/holder.js';
import { activeHolder } from '../setup/active.js';
import { junctionDirectory } from '../contract/wire/junction.js';
import { RESTART_RECORD } from '../contract/wire/restart.js';
import type { ProcessState } from '../contract/wire/probe.js';
import { readStartup } from './record.js';

class ProcessStateUnproven extends Data.TaggedError('ProcessStateUnproven')<{ readonly detail: string }> {}

export const readProcessState = Effect.fn('installation.readProcessState')(function* (data: string, env: NodeJS.ProcessEnv) {
  const reader = yield* Processes;
  const own = reader.identity(process.pid);
  if (own._tag !== 'Read')
    return yield* new ProcessStateUnproven({
      detail: own._tag === 'Unreadable' ? own.detail : 'the native reader could not identify this CLI',
    });
  const junction = junctionDirectory(env);
  const progress = yield* readStartup(join(data, RESTART_RECORD));
  const unmeasured = progress.restart?.unmeasured;
  if (unmeasured !== undefined)
    return yield* new ProcessStateUnproven({ detail: `the restart participants could not be measured: ${unmeasured}` });
  return {
    ...progress,
    held: dataDirectoryLocked(data) !== null,
    active: junction === null ? null : activeHolder(junction, reader),
  } satisfies ProcessState;
});
