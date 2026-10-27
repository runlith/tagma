import type { ServerCli } from '../installation/cli/port.js';
import type { Applications } from '../installation/contract/service/applications.js';

export const releaseVerbs = (cli: () => Promise<ServerCli>, applications: () => Promise<Applications>) => {
  const releases = async () => {
    const [found, port, placing] = await Promise.all([import('./cli.js'), cli(), applications()]);
    return { release: found.release(port), 'install-from': found.installFrom(port, placing) };
  };
  return { release: releases, 'install-from': releases } as const;
};
