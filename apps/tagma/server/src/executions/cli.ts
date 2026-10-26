import type { CommandCli } from './cli/command.js';

type VerbSource = () => Promise<Record<string, unknown>>;

export const executionVerbs = (binding: () => Promise<CommandCli>): Readonly<{ command: VerbSource; 'execution-host': VerbSource }> => ({
  command: async () => {
    const [{ command }, port] = await Promise.all([import('./cli/command.js'), binding()]);
    return { command: command(port) };
  },
  'execution-host': () => import('./cli/host.js'),
});
