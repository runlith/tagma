import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const graphCapability = {
  id: 'graph',
  description: "the project's knowledge graph and the law of writing it",
  sections: [
    'what-tagma-is',
    'the-checkout-and-the-graph',
    'graph-refusals',
    'block-references',
    'graph-reading',
    'graph-writing',
    'graph-evidence',
    'review',
  ],
} as const satisfies CapabilityDeclaration;
