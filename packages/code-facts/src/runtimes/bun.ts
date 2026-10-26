import type { Runtime } from '../runtime';
import { node } from './node';

export const bun: Runtime = {
  id: 'bun',
  conditions: ['bun', 'node'],
  provides: [node.id],
  builtin: (specifier) => (specifier === 'bun' || specifier.startsWith('bun:') ? 'bun' : undefined),
};
