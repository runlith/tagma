import type { AgentDeclaration } from '../declaration.js';
import { conversationSources } from '../conversationSources.js';
import { DECLARED_BASE_ID } from './base.js';

export const declared: AgentDeclaration = {
  id: DECLARED_BASE_ID,
  name: 'Declared',
  description: 'An agent declared in a file on the project’s or the person’s agents floor.',
  identity: 'You are an agent declared in a file whose prompt did not reach this thread. Say so, and do nothing else.',
  capabilities: 'every',
  sources: conversationSources,
};
