import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { dataPathOf } from '../platform/contract/service/store.js';
import { Result } from 'effect';
import type { Channel } from './contract/wire/channel.js';
import { HomeUnavailable } from './contract/wire/home.js';
import { DATABASE_FILE, dataDirectory, installationsRoot } from './contract/wire/layout.js';

export const databasePathIn = (channel: Channel, env: NodeJS.ProcessEnv): Result.Result<string, HomeUnavailable> => {
  const configured = env.TAGMA_DATABASE_PATH?.trim();
  if (configured) return Result.succeed(configured);
  const at = dataDirectory(channel, env);
  return at === null ? Result.fail(new HomeUnavailable({ variable: 'TAGMA_DATABASE_PATH' })) : Result.succeed(join(at, DATABASE_FILE));
};

export const installationRootIn = (channel: Channel, env: NodeJS.ProcessEnv): Result.Result<string, HomeUnavailable> => {
  const root = installationsRoot(channel, env);
  return root === null ? Result.fail(new HomeUnavailable({ variable: 'TAGMA_INSTALL_ROOT' })) : Result.succeed(root);
};

export const databasePath = (channel: Channel): string => Result.getOrThrow(databasePathIn(channel, process.env));

export const installationRoot = (channel: Channel): string => Result.getOrThrow(installationRootIn(channel, process.env));

export const launcherPath = (channel: Channel): string => `${dirname(installationRoot(channel))}/bin/${channel.command}`;

export function seedDirectory(): string {
  return process.env.TAGMA_SEED_DIRECTORY?.trim() || tmpdir();
}

export const installationAnchor = (storePath: string): string => dataPathOf(storePath) ?? tmpdir();
