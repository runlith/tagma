import { Console, Effect } from 'effect';
import { Command } from 'effect/cli';
import { SetupSteps } from '../contract/service/steps.js';
import { end, noting, CurrentInvocation, print } from '../../platform/cli/verb.js';
import { json, optional, project } from './server.js';
import type { InstallationCli, Refreshed } from './port.js';
import { OUTLINE_OPERATIONS } from '../../graph/contract/wire/operations/outline.js';
import { REGISTRY_OPERATIONS } from '../../graph/contract/wire/operations/registry.js';

const declaring = Effect.gen(function* () {
  const steps = yield* SetupSteps;
  return async (repoRoot: string) => [...(await Effect.runPromise(steps.run(repoRoot)))];
});

export const install = <User, Repo, Entry extends Refreshed>(cli: InstallationCli<User, Repo, Entry>) =>
  Command.make('install', { json, project }, ({ json, project }) =>
    Effect.gen(function* () {
      const { perform, here, lens, installForUser, installInto, renderInstallResult, renderUserInstallResult } = cli;
      const at = yield* CurrentInvocation;
      const repoRoot = yield* Effect.promise(async () => {
        const toplevel = Bun.spawn(['git', 'rev-parse', '--show-toplevel'], {
          cwd: at.cwd,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'ignore',
        });
        const [printed, code] = await Promise.all([new Response(toplevel.stdout).text(), toplevel.exited]);
        return code === 0 ? printed.trim() : '';
      });
      if (!repoRoot) {
        yield* Console.error('tagma install runs inside a git repository');
        return end(1);
      }
      const read = yield* Effect.result(perform(REGISTRY_OPERATIONS.read_project, {}, here(at)));
      if (read._tag === 'Failure') yield* Effect.logDebug('the project was not read, so the install goes by the repository', read.failure);
      const current = read._tag === 'Success' ? read.success.project : null;
      if (current?.private === true) {
        const served = yield* installForUser();
        if (json) return yield* print(served, true);
        for (const line of renderUserInstallResult(served, current.name ?? 'this project')) yield* Console.log(line);
        return;
      }
      const { law: section } = yield* perform(OUTLINE_OPERATIONS.read_law, {}, lens(at, { project: optional(project) }));
      const declare = yield* declaring;
      const installed = yield* installInto(repoRoot, section, declare);
      if (json) return yield* print(installed, true);
      for (const line of renderInstallResult(installed)) yield* Console.log(line);
    }),
  ).pipe(
    Command.withDescription('install Tagma for this repository: law, skill, hooks'),
    noting(`Plants the law into AGENTS.md, the skill into .agents/skills/tagma with the
.claude symlink, and the harness hooks. A project marked private
keeps Tagma out of its checkout: the skill and hooks land at the user layer and
the repository is untouched.`),
  );

export const upgrade = <User, Repo, Entry extends Refreshed>(cli: InstallationCli<User, Repo, Entry>) =>
  Command.make('upgrade', { json }, ({ json }) =>
    Effect.gen(function* () {
      const { perform, here, refreshInstallations, renderUpgradeResult } = cli;
      const at = yield* CurrentInvocation;
      const done = yield* refreshInstallations({
        projects: Effect.map(perform(REGISTRY_OPERATIONS.list_projects, {}, here(at)), (answer) => answer.projects),
        law: (projectId) => Effect.map(perform(OUTLINE_OPERATIONS.read_law, {}, { project: String(projectId) }), (answer) => answer.law),
        declare: yield* declaring,
      });
      if (json) {
        yield* print(done, true);
      } else {
        for (const line of renderUpgradeResult(done)) yield* Console.log(line);
      }
      if (done.some((entry) => entry.failed !== undefined)) end(1);
    }),
  ).pipe(
    Command.withDescription('bring every place Tagma already stands up to what ships; creates nothing'),
    noting(`Walks the registry: each project refreshed in ITS OWN shape — into the
checkout, or at the user layer, which is refreshed once however many projects
it serves. A place Tagma never stood in is named and skipped, never planted.
A place that fails names its failure and the walk continues over the rest.`),
  );
