import { artifactsVerbs } from '../../artifacts/cli.js';
import { cliVerbs } from '../../cli/verbs.js';
import { enforcementVerbs } from '../../enforcement/cli.js';
import { executionVerbs } from '../../executions/cli.js';
import { externalHarnessVerbs } from '../../external-harnesses/cli.js';
import { graphVerbs } from '../../graph/cli.js';
import { installationVerbs } from '../../installation/cli.js';
import { nativeHarnessVerbs } from '../../native-harness/cli.js';
import { projectsVerbs } from '../../projects/cli.js';
import { providersVerbs } from '../../providers/cli.js';
import { sandboxVerbs } from '../../sandbox/cli.js';
import { threadsVerbs } from '../../threads/cli.js';
import type { VerbModule } from './binding.js';

export const CORE_VERB_MODULES: readonly VerbModule[] = [
  { id: 'projects', verbs: projectsVerbs },
  { id: 'providers', verbs: providersVerbs },
  { id: 'graph', verbs: graphVerbs },
  { id: 'installation', verbs: installationVerbs },
  { id: 'artifacts', verbs: artifactsVerbs },
  { id: 'executions', verbs: executionVerbs },
  { id: 'enforcement', verbs: enforcementVerbs },
  { id: 'sandbox', verbs: sandboxVerbs },
  { id: 'threads', verbs: threadsVerbs },
  { id: 'native-harness', verbs: nativeHarnessVerbs },
  { id: 'external-harnesses', verbs: externalHarnessVerbs },
  { id: 'cli', verbs: cliVerbs },
];
