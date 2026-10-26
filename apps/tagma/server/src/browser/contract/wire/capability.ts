import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const browserCapability = {
  id: 'browser',
  description: 'pages of the browser built into Tagma: opening, reading, acting on, capturing and debugging them, and its profiles',
  sections: [],
} as const satisfies CapabilityDeclaration;
