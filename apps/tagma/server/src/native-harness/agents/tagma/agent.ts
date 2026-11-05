import type { AgentDeclaration } from '../declaration.js';
import { conversationSources } from '../conversationSources.js';
import { identity } from './identity.js';

export const tagma: AgentDeclaration = {
  id: 'tagma',
  name: 'Tagma',
  description: 'The Tagma agent: one home thread, working across the machine’s registered projects.',
  identity,
  capabilities: [
    'graph',
    'agents',
    'files',
    'shell',
    'web',
    'mcp',
    'plugins',
    'skills',
    'threads',
    'peers',
    'resources',
    'sandbox',
    'worktrees',
    'terminals',
    'speech',
    'artifacts',
  ],
  sources: conversationSources,
};
