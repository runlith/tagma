import type { AgentDeclaration } from './declaration.js';
import { declared } from './declared/agent.js';
import { harness } from './harness/agent.js';
import { tagma } from './tagma/agent.js';

export const DECLARATIONS: readonly AgentDeclaration[] = [tagma, declared, harness];
