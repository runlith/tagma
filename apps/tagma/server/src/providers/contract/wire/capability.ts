import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const adaptersCapability = {
  id: 'adapters',
  description:
    'model provider adapters on this machine: installing, updating, switching or removing one, keeping its settings, and refreshing the models a provider offers',
  sections: [],
  joins: ['tagma'],
} as const satisfies CapabilityDeclaration;
