import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const sandboxCapability = {
  id: 'sandbox',
  description: 'preparing an isolated tree a child can be born against',
  sections: [],
} as const satisfies CapabilityDeclaration;
