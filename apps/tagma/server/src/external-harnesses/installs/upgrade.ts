import { Clock, Effect, FileSystem } from 'effect';
import { integratesProjects } from '../../installation/contract/wire/junction.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { installRefresh } from '../store/installs.js';
import type { HooksWrite } from './hookInstall.js';
import { installFailure, type McpDeclarationWrite } from '../../installation/contract/wire/install.js';
import { installForUser, installInto } from './skillInstall.js';
import { declareForLaunch } from './mcpDeclaration.js';
import { skillTarget, userSkillTarget } from './targets.js';
import { HarnessAdapters } from '../contract/service/adapters.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import type { SectionCatalog } from '../../platform/contract/service/sections.js';

export type UpgradeEntry = {
  place: string;
  skipped?: string;
  skill?: string;
  law?: string;
  hooks?: HooksWrite[];
  mcp?: McpDeclarationWrite[];
  failed?: string;
};

export type Registered = { readonly id: number; readonly name: string; readonly rootPath: string; readonly private: boolean };

const NEVER_STOOD = 'Tagma never stood here';

const reasonOf = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const attemptPlace = <E, R>(place: string, work: Effect.Effect<UpgradeEntry, E, R>) =>
  Effect.match(work, { onFailure: (failure): UpgradeEntry => ({ place, failed: reasonOf(failure) }), onSuccess: (entry) => entry });

export const standing = Effect.fn('harnessInstall.standing')(function* (privately: boolean, root: string) {
  const files = yield* FileSystem.FileSystem;
  if (!(yield* files.exists(privately ? userSkillTarget() : skillTarget(root)))) return { _tag: 'Absent' } as const;
  return privately ? ({ _tag: 'User' } as const) : ({ _tag: 'Checkout', root } as const);
});

export const refreshInstallations = Effect.fn('harnessInstall.refresh')(function* <E, F>(
  projectsRead: Effect.Effect<readonly Registered[], E>,
  law: (projectId: number) => Effect.Effect<string, F>,
  declare: (repoRoot: string) => Promise<McpDeclarationWrite[]>,
  contributed: SectionCatalog,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!integratesProjects(env)) return [];
  const projects = yield* projectsRead;
  const done: UpgradeEntry[] = [];
  const shared = projects.find((row) => row.private);
  if (shared !== undefined) {
    done.push(
      yield* attemptPlace(
        'user layer',
        Effect.gen(function* () {
          if ((yield* standing(true, shared.rootPath))._tag === 'Absent') return { place: 'user layer', skipped: NEVER_STOOD };
          const user = yield* installForUser(contributed);
          return { place: 'user layer', skill: user.skill.target, hooks: user.hooks };
        }),
      ),
    );
  }
  for (const row of projects) {
    if (row.private) continue;
    done.push(
      yield* attemptPlace(
        row.name,
        Effect.gen(function* () {
          const stand = yield* standing(false, row.rootPath);
          if (stand._tag !== 'Checkout') return { place: row.name, skipped: NEVER_STOOD };
          const installed = yield* installInto(stand.root, yield* law(row.id), declare, contributed);
          return {
            place: row.name,
            skill: installed.skill.target,
            law: `${installed.agents.write} ${installed.agents.path}`,
            hooks: installed.hooks,
            mcp: installed.mcp,
          };
        }),
      ),
    );
  }
  return done;
});

export const refreshedFor = Effect.fn('harnessInstall.refreshedFor')(function* <E, R>(
  build: string,
  refresh: Effect.Effect<readonly UpgradeEntry[], E, R>,
) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const standing = yield* units.read((unit) => unit.run(db.select({ build: installRefresh.build }).from(installRefresh).get()));
  if (standing?.build === build) return null;
  const entries = yield* refresh;
  const refreshedAt = new Date(yield* Clock.currentTimeMillis);
  yield* units.write(writes('harnessInstall.refreshedFor', [installRefresh]), (unit) =>
    Effect.andThen(unit.run(db.delete(installRefresh)), unit.run(db.insert(installRefresh).values({ build, refreshedAt }))),
  );
  return entries;
});

export const declaredForLaunch = Effect.fn('harnessInstall.declaredForLaunch')(function* (
  name: HarnessName,
  privately: boolean,
  root: string,
  cli: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!integratesProjects(env)) return null;
  const adapter = yield* (yield* HarnessAdapters).row(name);
  const surface = adapter.mcp;
  if (surface === null || surface.file._tag !== 'Project') return null;
  const stand = yield* standing(privately, root);
  if (stand._tag !== 'Checkout') return null;
  const written = yield* Effect.tryPromise({
    try: () => declareForLaunch(stand.root, adapter, surface, cli),
    catch: installFailure,
  });
  if (written.write === 'refused' || written.approved === 'refused')
    yield* Effect.logWarning('the MCP declaration of this project was not brought up to date before the launch', written);
  return written;
}, Effect.mapError(installFailure));
