import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { body, pair } from '../../platform/contract/service/body.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { readInstallation, refusalDetail } from '../closure/read.js';
import { CURRENT } from '../contract/wire/layout.js';
import { INSTALLATION_OPERATIONS as OPS } from '../contract/wire/operations.js';
import type { Channel } from '../contract/wire/channel.js';
import { InstalledChannel } from '../contract/service/channel.js';
import { installationRoot, launcherPath } from '../paths.js';
import { reachLine, worldDirectory, writeLauncher } from '../setup/launcher.js';

export const shellEnv = (channel: Channel): NodeJS.ProcessEnv => {
  const world = resolve(worldDirectory(installationRoot(channel)));
  const path = (process.env.PATH ?? '')
    .split(':')
    .filter((entry) => entry === '' || resolve(entry) !== world)
    .join(':');
  return { ...process.env, PATH: path, SHELL: process.env.SHELL || userInfo().shell || '' };
};

export const placeCommand = pair(
  OPS.place_command,
  body(OPS.place_command, {
    execute: Effect.fnUntraced(function* () {
      const channel = yield* InstalledChannel;
      const root = installationRoot(channel);
      const standing = yield* readInstallation(join(root, CURRENT)).pipe(
        Effect.provide(BunFileSystem.layer),
        Effect.mapError(
          (failure) =>
            new GateRefusal('no-installation', refusalDetail(failure), [
              `open ${channel.name}.app — its first launch installs the release it carries`,
            ]),
        ),
      );
      const written = yield* writeLauncher(root, launcherPath(channel), standing.platform, shellEnv(channel)).pipe(
        Effect.provide(BunFileSystem.layer),
        Effect.mapError(
          (failure) =>
            new GateRefusal('path-unwritten', `${failure.path}: ${failure.detail}`, [`make ${failure.path} writable, then ask again`]),
        ),
      );
      return { status: 'placed' as const, launcher: written.path, said: reachLine(written) };
    }),
  }),
);
