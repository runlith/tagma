import { composePosix } from './posix';
import { processReader, processWorker } from '../posix/linux/processes';
import { platformFacts, platformIdentity } from '../posix/linux/facts';
import { evidenceProbe } from '../posix/linux/evidence';
import { fileHolders } from '../posix/linux/holders';
import { openUsage } from '../posix/Usage';

export const system = composePosix({
  processes: processReader,
  facts: platformFacts,
  identity: platformIdentity,
  evidence: evidenceProbe,
  usage: (path) => openUsage(path, processWorker),
  fileHolders,
});
