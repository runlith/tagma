import type { WorkflowsCli } from './cli/workflows.js';

export const nativeHarnessVerbs = (binding: () => Promise<WorkflowsCli>) => ({
  workflow: async () => {
    const [{ workflow }, port] = await Promise.all([import('./cli/workflows.js'), binding()]);
    return { workflow: workflow(port) };
  },
});
