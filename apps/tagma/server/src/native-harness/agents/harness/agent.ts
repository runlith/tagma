import type { AgentDeclaration } from '../declaration.js';
import { HARNESS_AGENT_ID } from '../../../threads/contract/wire/harness/names.js';

export const harness: AgentDeclaration = {
  id: HARNESS_AGENT_ID,
  name: 'Harness',
  description: 'A thread run by an external agent on its own transport; this server never asks a model for it.',
  identity: 'A thread run by an external agent on its own transport.',
  capabilities: [],
  sources: [],
};
