import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Layer } from 'effect';
import { ClaimHolders } from '../../executions/contract/service/host.js';
import { hostsStaying } from '../../executions/host/staying.js';
import { GRAPH_STEPS } from '../../graph/steps/sequence.js';
import { build } from '../../installation/cut/build.js';
import { runCut } from '../../installation/cut/command.js';
import type { Composition } from '../../installation/cut/descriptor.js';
import type { InstanceHosts } from '../../installation/cut/port.js';
import { cutCommand, notarizeCommand, shipCommand } from '../../installation/cut/publish.js';
import { transitionCommand } from '../../installation/cut/transition.js';
import { tryout } from '../../installation/cut/try.js';
import type { Channel } from '../../installation/contract/wire/channel.js';
import { readRemoteStartup } from '../../installation/process/serverStart.js';
import { CurrentInvocation } from '../../platform/cli/verb.js';
import type { Build } from '../build.js';
import { doorOf } from '../cli/door.js';
import { SIGNERS } from '../cli/signers.js';
import { entryKinds } from '../entryKinds.js';
import { readBuildAttribution } from './attribution.js';
import { claimHoldersLayer } from '../hostClaims.js';

const cutOf = async (of: Build): Promise<Composition> => {
  const { modules, rested } = await of.parts();
  return {
    ...of.cut,
    channel: of.channel,
    steps: {
      graph: GRAPH_STEPS.map((step) => step.id),
      journal: entryKinds(modules, rested).steps.map((step) => step.name),
    },
    stores: modules.flatMap((module) => module.stores ?? []),
  };
};

export const releaseCut = async (of: Build, given: readonly string[]): Promise<void> => {
  const composition = await cutOf(of);
  await runCut(
    given[0] === 'publish'
      ? shipCommand(given.slice(1), composition)
      : given[0] === 'notarize'
        ? notarizeCommand(given.slice(1), composition)
        : cutCommand(given, composition),
  );
};

export const transitionCut = async (of: Build, given: readonly string[]): Promise<void> =>
  runCut(transitionCommand(given, await cutOf(of)));

const serverAt = (channel: Channel) => {
  const door = doorOf(channel);
  return {
    door,
    startup: () => Effect.flatMap(CurrentInvocation, (at) => readRemoteStartup(door.baseUrl(at))),
  };
};

export const buildCut = async (of: Build, given: readonly string[]): Promise<void> => {
  const { door, startup } = serverAt(of.channel);
  await runCut(
    build(
      { ask: door.ask, baseUrl: door.baseUrl, boundHere: door.boundHere, healthOrNone: door.healthOrNone, startup },
      given,
      { channel: of.channel, checkout: of.cut.roots.checkout, composition: Effect.promise(() => cutOf(of)) },
      readBuildAttribution(door),
    ),
  );
};

const hosts: InstanceHosts = {
  staying: (database) =>
    Effect.flatMap(Effect.all([ClaimHolders, FileSystem.FileSystem]), ([holders, files]) => hostsStaying(holders, files, database)).pipe(
      Effect.map((staying) =>
        staying.map(({ state, claim }) => ({
          state,
          holders: claim._tag === 'Held' ? claim.holders : [],
          detail: claim._tag === 'Unmeasured' ? claim.detail : null,
        })),
      ),
      Effect.provide(Layer.merge(BunFileSystem.layer, claimHoldersLayer)),
    ),
};

export const tryCut = async (of: Build, working: Channel, given: readonly string[]): Promise<void> => {
  const { door, startup } = serverAt(working);
  await runCut(
    tryout(
      { baseUrl: door.baseUrl, healthOrNone: door.healthOrNone, startup },
      hosts,
      given,
      SIGNERS.flatMap(({ variable }) => (variable === undefined ? [] : [variable])),
      await cutOf(of),
    ),
    ['SIGTERM', 'SIGINT', 'SIGHUP'],
  );
};
