import type { WorkflowsCli } from './cli/workflows.js';

type VerbSource = () => Promise<Record<string, unknown>>;

export const nativeHarnessVerbs = (binding: () => Promise<WorkflowsCli>): Readonly<{ workflow: VerbSource }> => ({
  workflow: async () => {
    const [{ workflow }, port] = await Promise.all([import('./cli/workflows.js'), binding()]);
    return { workflow: workflow(port) };
  },
});
