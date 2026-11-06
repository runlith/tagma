import type { ServerCli } from '../installation/cli/port.js';

export const freshVerbs = (cli: () => Promise<ServerCli>) => ({
  fresh: async () => {
    const [found, port] = await Promise.all([import('./cli.js'), cli()]);
    return { fresh: found.fresh(port) };
  },
});
