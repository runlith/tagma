import type { EnforcementCli } from './cli/port.js';

export const enforcementVerbs = (binding: () => Promise<EnforcementCli>) => ({
  check: async () => {
    const [{ check }, road] = await Promise.all([import('./cli/check.js'), binding()]);
    return { check: check(road) };
  },
  'merge-driver': async () => {
    const { mergeDriver } = await import('./cli/merge.js');
    return { 'merge-driver': mergeDriver };
  },
});
