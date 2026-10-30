import type { AgentDeclaration } from '../declaration.js';
import { HARNESS_AGENT_ID } from '../../../threads/contract/wire/harness/names.js';

export const harness: AgentDeclaration = {
  id: HARNESS_AGENT_ID,
  name: 'Harness',
  description:
    'A thread run by an external agent on its own transport, as its harness declares it: a CLI in a terminal or an agent over ACP. Each installed harness offers it as its own type, harness:<id>.',
  identity: 'A thread run by an external agent on its own transport.',
  capabilities: [],
  sources: [],
};
