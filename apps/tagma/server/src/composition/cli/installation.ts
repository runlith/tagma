import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect } from 'effect';
import type { InstallationCli } from '../../installation/cli/port.js';
import { here, lens } from '../../cli/door.js';
import { door } from './door.js';
import { installerAdapters } from './installerAdapters.js';
import { perform } from './perform.js';
import { renderInstallResult, renderUpgradeResult, renderUserInstallResult } from '../../external-harnesses/installs/render.js';
import type { RepoInstall, UserInstall } from '../../external-harnesses/installs/skillInstall.js';
import type { UpgradeEntry } from '../../external-harnesses/installs/upgrade.js';
import { doctrine } from '../doctrine.js';
import { CurrentInvocation } from '../../platform/cli/verb.js';
import { readRemoteStartup } from '../../installation/process/serverStart.js';

export const installationCli: InstallationCli<UserInstall, RepoInstall, UpgradeEntry> = {
  perform,
  ask: door.ask,
  baseUrl: door.baseUrl,
  boundAddress: door.boundAddress,
  boundHere: door.boundHere,
  health: door.health,
  healthOrNone: door.healthOrNone,
  startup: () => Effect.flatMap(CurrentInvocation, (at) => readRemoteStartup(door.baseUrl(at))),
  here,
  lens,
  installForUser: () =>
    Effect.flatMap(
      Effect.all([Effect.promise(() => import('../../external-harnesses/installs/skillInstall.js')), doctrine]),
      ([{ installForUser }, { contributed }]) => installForUser(contributed),
    ).pipe(Effect.provide(BunFileSystem.layer), Effect.provide(installerAdapters)),
  installInto: (repoRoot, lawSection, declare) =>
    Effect.flatMap(
      Effect.all([Effect.promise(() => import('../../external-harnesses/installs/skillInstall.js')), doctrine]),
      ([{ installInto }, { contributed }]) => installInto(repoRoot, lawSection, declare, contributed),
    ).pipe(Effect.provide(BunFileSystem.layer), Effect.provide(installerAdapters)),
  refreshInstallations: (deps) =>
    Effect.flatMap(
      Effect.all([Effect.promise(() => import('../../external-harnesses/installs/upgrade.js')), doctrine]),
      ([{ refreshInstallations }, { contributed }]) => refreshInstallations(deps.projects, deps.law, deps.declare, contributed),
    ).pipe(Effect.provide(BunFileSystem.layer), Effect.provide(installerAdapters)),
  renderInstallResult,
  renderUserInstallResult,
  renderUpgradeResult,
};
