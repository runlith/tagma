import { CHANNELS, type Channel } from '../installation/contract/wire/channel.js';
import { dataDirectory, installationsRoot } from '../installation/contract/wire/layout.js';
import type { HealthAnswer } from './port.js';

export const besideRoot = (channel: Channel, home: string): string => `${home}/${channel.data}-try`;

export const besideHome = (root: string): string => `${root}/home`;

export const besidePort = (channel: Channel): number => channel.port + 100;

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
