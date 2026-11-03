import * as BunServices from '@effect/platform-bun/BunServices';
import { Layer } from 'effect';
import type { Command } from 'effect/cli';
import type { Processes } from '@runlith/execution-host/ProcessReader';
import { InstalledChannel } from '../../installation/contract/service/channel.js';
import type { LockHolders } from '../../installation/contract/service/lockHolders.js';
import type { Channel } from '../../installation/contract/wire/channel.js';
import { ownProcessesLayer } from '../children.js';
import { lockHoldersLayer } from '../hostClaims.js';

export type CliEnvironment = Command.Environment | InstalledChannel | Processes | LockHolders;

export const cliEnvironment = (channel: Channel, packages: string): Layer.Layer<CliEnvironment> =>
  Layer.mergeAll(BunServices.layer, Layer.succeed(InstalledChannel, channel), ownProcessesLayer(packages), lockHoldersLayer);
