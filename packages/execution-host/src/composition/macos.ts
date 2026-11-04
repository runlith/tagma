import { composePosix } from './posix';
import { processReader, processWorker } from '../posix/macos/processes';
import { platformFacts, platformIdentity } from '../posix/macos/facts';
import { evidenceProbe } from '../posix/macos/evidence';
import { MACHINE_PROBE_LIMITS } from '../posix/macos/standing';
import { fileHolders } from '../posix/macos/holders';
import { openUsage } from '../posix/Usage';

export const system = composePosix({
  processes: processReader,
  facts: platformFacts,
  identity: platformIdentity,
  evidence: evidenceProbe({ ...MACHINE_PROBE_LIMITS, probeMs: 2_000 }),
  usage: (path) => openUsage(path, processWorker),
  fileHolders,
  worker: processWorker,
});
