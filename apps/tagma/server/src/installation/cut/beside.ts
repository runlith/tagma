import { CHANNELS, type Channel } from '../contract/wire/channel.js';
import { DATABASE_FILE, INSTALLATIONS, dataDirectory, installationsRoot } from '../contract/wire/layout.js';
import { portBlock, portsEnv } from '../contract/wire/ports.js';
import type { HealthAnswer } from './port.js';
import { INSTALLATION_MODE } from '../contract/wire/junction.js';

export const besideRoot = (channel: Channel, home: string): string => `${home}/${channel.data}-try`;

export const besideDataDirectory = (root: string): string => `${root}/data`;

export const besideHome = (root: string): string => `${root}/home`;

export const besidePort = (channel: Channel): number => channel.port + 100;

export const besideEnv = (root: string, port: number): Record<string, string> => ({
  [INSTALLATION_MODE]: 'beside',
  TAGMA_DATABASE_PATH: `${besideDataDirectory(root)}/${DATABASE_FILE}`,
  TAGMA_INSTALL_ROOT: `${root}/${INSTALLATIONS}`,
  ...portsEnv(portBlock(port)),
});

export const answeredHere = (answered: HealthAnswer | null, database: string): boolean =>
  answered !== null && answered.health.database === database;

const within = (path: string, other: string): boolean => path === other || path.startsWith(`${other}/`);

export const besideConflict = (root: string, env: NodeJS.ProcessEnv): string | null => {
  const home = env.HOME?.trim();
  const working = Object.values(CHANNELS).flatMap((channel) => [
    ...(home ? [`${home}/${channel.data}`, `${home}/${channel.data.replace(/^\./, '')}`] : []),
    ...[dataDirectory(channel, env), installationsRoot(channel, env)].filter((path): path is string => path !== null),
  ]);
  return working.find((path) => within(root, path) || within(path, root)) ?? null;
};
