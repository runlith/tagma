import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const artifactsCapability = {
  id: 'artifacts',
  description: 'reading the pages this server hosts',
  sections: [],
} as const satisfies CapabilityDeclaration;
