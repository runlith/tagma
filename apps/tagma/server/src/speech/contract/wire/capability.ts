import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const speechCapability = {
  id: 'speech',
  description: 'speaking aloud and listening on the machine running this server, and reading what was heard',
  sections: [],
} as const satisfies CapabilityDeclaration;
