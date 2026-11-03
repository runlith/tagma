import type { CommandCli } from './cli/command.js';

export const executionVerbs = (binding: () => Promise<CommandCli>) => ({
  command: async () => {
    const [{ command }, port] = await Promise.all([import('./cli/command.js'), binding()]);
    return { command: command(port) };
  },
  'execution-host': () => import('./cli/host.js'),
});
