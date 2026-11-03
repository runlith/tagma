import type { SandboxCli } from './cli/port.js';

export const sandboxVerbs = (binding: () => Promise<SandboxCli>) => ({
  sandbox: async () => {
    const [{ sandboxCommand }, road] = await Promise.all([import('./cli/sandbox.js'), binding()]);
    return { sandbox: sandboxCommand(road) };
  },
});
