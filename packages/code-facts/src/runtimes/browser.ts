import type { Runtime } from '../runtime';

export const browser: Runtime = {
  id: 'browser',
  conditions: ['browser'],
  provides: [],
  builtin: () => undefined,
};
