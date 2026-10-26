import type { ServerCli } from '../installation/cli/port.js';

export const buildVerbs = (cli: () => Promise<ServerCli>) => {
  const builds = async () => {
    const [found, port] = await Promise.all([import('./cli.js'), cli()]);
    return { build: found.build(port), update: found.update(port) };
  };
  return { build: builds, update: builds } as const;
};
