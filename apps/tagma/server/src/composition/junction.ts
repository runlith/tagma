import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Cause, Context, Effect } from 'effect';
import { CHANNEL } from '@tagma/server/composition/channel';
import { takeActive } from '../installation/setup/active.js';
import { channelActive, entryCommand, integratesProjects, junctionDirectory } from '../installation/contract/wire/junction.js';
import { placeEntry } from '../installation/setup/entry.js';
import { installHomes } from '../external-harnesses/installs/skillInstall.js';
import { refreshedFor, refreshInstallations } from '../external-harnesses/installs/upgrade.js';
import { installMcpDeclarations } from '../external-harnesses/installs/mcpDeclaration.js';
import { renderUpgradeResult } from '../external-harnesses/installs/render.js';
import { Doctrine, doctrineOf } from '../platform/contract/service/sections.js';
import { Projects } from '../projects/contract/service/registry.js';
import { ProjectPolicy, type ServedGraphs } from '../graph/contract/service/serving.js';
import { Orientation } from '../graph/contract/service/orientation.js';

export const holdJunction = (env: NodeJS.ProcessEnv, cli: string, url: string): (() => void) => {
  const junction = junctionDirectory(env);
  if (junction === null) {
    console.error('[tagma] HOME names no place for the lock that keeps one Tagma running on this Mac; start it with HOME set');
    return process.exit(1);
  }
  const taken = takeActive(junction, { channel: CHANNEL.id, cli, url, pid: process.pid });
  if (taken._tag === 'Held') {
    const said = channelActive(taken.holder ?? 'unnamed', CHANNEL);
    console.error(`[tagma] channel-active: ${said.reason}`);
    for (const way of said.unblock) console.error(`[tagma] unblock: ${way}`);
    return process.exit(1);
  }
  if (taken._tag === 'Unlocked') {
    console.error(`[tagma] the active lock could not be taken: ${taken.detail}`);
    return process.exit(1);
  }
  const entry = placeEntry(env);
  if (entry._tag === 'Unplaced') console.warn(`[tagma] the entry point was not placed: ${entry.detail}`);
  return taken.release;
};

export const installationsRefreshed = (build: string | null, pool: ServedGraphs['Service'], env: NodeJS.ProcessEnv) =>
  build === null || !integratesProjects(env)
    ? Effect.void
    : Effect.gen(function* () {
        const contributed = doctrineOf(yield* Doctrine).contributed;
        const projects = yield* Projects;
        const policy = yield* ProjectPolicy;
        const registered = Effect.flatMap(projects.list(), (rows) =>
          Effect.map(policy.read(rows.map((row) => row.id)), (found) => [...found.values()].filter((row) => !row.private)),
        );
        const law = (projectId: number) =>
          Effect.flatMap(pool.resolve({ projectId }), (served) =>
            served
              .fresh()
              .pipe(Effect.andThen(Context.get(served.context, Orientation).law({ projectId })), Effect.provide(served.context)),
          );
        const done = yield* refreshedFor(
          build,
          refreshInstallations(registered, law, (root) => installMcpDeclarations(root, entryCommand(env)), contributed, env),
        ).pipe(Effect.provide(BunFileSystem.layer));
        for (const entry of done ?? []) {
          if (entry.skipped !== undefined) continue;
          const lines = renderUpgradeResult([entry]);
          if (entry.failed !== undefined) console.error(`[tagma] the installation was not refreshed: ${lines.join(' ')}`);
          else for (const line of lines) console.log(`[tagma] installation refreshed for ${build}: ${line}`);
        }
      }).pipe(
        Effect.tapCause((cause) =>
          Effect.sync(() => console.error('[tagma] the installations in registered projects were not refreshed', Cause.pretty(cause))),
        ),
      );

export const homesIntegrated = (env: NodeJS.ProcessEnv) =>
  Effect.flatMap(installHomes(entryCommand(env)).pipe(Effect.provide(BunFileSystem.layer)), (done) =>
    Effect.sync(() => {
      for (const home of done) {
        if ('failed' in home) {
          console.error(`[tagma] the ${home.harness} home integrations were not written: ${home.failed}`);
          continue;
        }
        const written = [...home.installed.hooks, ...(home.installed.mcp === undefined ? [] : [home.installed.mcp])].filter(
          (write) => write.write !== 'current',
        );
        for (const write of written) console.log(`[tagma] ${home.harness} home: ${write.path} ${write.write}`);
      }
    }),
  );
