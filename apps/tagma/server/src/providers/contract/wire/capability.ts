import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const adaptersCapability = {
  id: 'adapters',
  description: 'model provider adapters on this machine: installing, updating, switching or removing one, and keeping its settings',
  sections: [],
  joins: ['tagma'],
} as const satisfies CapabilityDeclaration;
