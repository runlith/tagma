import type { SandboxCli } from './cli/port.js';

type VerbSource = () => Promise<Record<string, unknown>>;

export const sandboxVerbs = (binding: () => Promise<SandboxCli>): Readonly<{ sandbox: VerbSource }> => ({
  sandbox: async () => {
    const [{ sandboxCommand }, road] = await Promise.all([import('./cli/sandbox.js'), binding()]);
    return { sandbox: sandboxCommand(road) };
  },
});
