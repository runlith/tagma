import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const terminalsCapability = {
  id: 'terminals',
  description: 'starting, watching, typing into and ending managed executions of this project',
  sections: ['held-processes'],
} as const satisfies CapabilityDeclaration;
