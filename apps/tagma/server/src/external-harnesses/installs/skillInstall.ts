import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { Doctrine, doctrineOf } from '../../platform/contract/service/sections.js';
import { withFileLock } from '@runlith/file-lock/FileLock';
import { declareInto } from './mcpDeclaration.js';
import { type InstallFailed, installFailure } from '../../installation/contract/wire/install.js';
import type { SectionCatalog } from '../../platform/contract/service/sections.js';
import type { HookUserFile } from '@runlith/tagma/adapter/harness';
import { applyClaudeLaw, applyLaw, planClaudeLaw, planLawSection, type ClaudeLawWrite, type LawWrite } from './law.js';
import type { McpDeclarationWrite } from '../../installation/contract/wire/install.js';
import { entriesOf, hookGroups, type HooksWrite } from './hookInstall.js';
import { HARNESSES, harnessAdapter } from '../contract/service/table.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import { applyHooks, planHooks, planHookFiles } from './hookWrite.js';
import { installedBody, sourceFiles } from './skill.js';
import { skillLinkTarget, skillTarget, userSkillTarget } from './targets.js';
import { skillStatus } from './status.js';
import { InstalledHarnesses } from '../../threads/contract/service/harness.js';

export const installSkill = Effect.fn('harnessInstall.installSkill')(function* (target: string, contributed: SectionCatalog) {
  const disk = yield* FileSystem.FileSystem;
  const files = sourceFiles();
  const bodies = yield* Effect.try({
    try: () => files.map((file) => [file, installedBody(file, contributed)] as const),
    catch: installFailure,
  });
  yield* disk.remove(target, { recursive: true, force: true });
  for (const [file, body] of bodies) {
    const destination = join(target, file);
    yield* disk.makeDirectory(dirname(destination), { recursive: true });
    yield* disk.writeFile(destination, body);
  }
  return { target, files };
}, Effect.mapError(installFailure));

export const linkSkill = Effect.fn('harnessInstall.linkSkill')(function* (repoRoot: string) {
  const disk = yield* FileSystem.FileSystem;
  const link = skillLinkTarget(repoRoot);
  const canonical = skillTarget(repoRoot);
  yield* disk.makeDirectory(dirname(link), { recursive: true });
  const same = yield* Effect.all([disk.realPath(dirname(link)), disk.realPath(dirname(canonical))]).pipe(
    Effect.map(([left, right]) => left === right),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(false)),
  );
  if (same) return link;
  yield* disk.remove(link, { recursive: true, force: true });
  yield* disk.symlink(join('..', '..', '.agents', 'skills', 'tagma'), link);
  return link;
}, Effect.mapError(installFailure));

const AGENTS_FILE = 'AGENTS.md';
const CLAUDE_FILE = 'CLAUDE.md';

export type RepoInstall = {
  skill: { target: string; files: string[] };
  link: string;
  agents: { path: string; write: LawWrite };
  claude: { path: string; write: ClaudeLawWrite };
  hooks: HooksWrite[];
  mcp: McpDeclarationWrite[];
};

export type UserInstall = {
  skill: { target: string; files: string[] };
  hooks: HooksWrite[];
  mcp?: McpDeclarationWrite;
};

const userFileKey = (declared: HookUserFile): string => join(...declared.folder, declared.file);

export const installForUser = Effect.fnUntraced(function* (contributed: SectionCatalog) {
  const plans = yield* Effect.forEach(
    hookGroups((surface) => (surface.user === null ? `project:${surface.file}` : userFileKey(surface.user))).flatMap((group) => {
      const declared = group.adapters[0]!.hooks?.user ?? null;
      return declared === null ? [] : [{ declared, group }];
    }),
    ({ declared, group }) =>
      planHookFiles(
        join(userHome(declared), declared.file),
        group.format,
        entriesOf(group.adapters),
        group.adapters.flatMap((adapter) => adapter.hooks?.assets ?? []),
      ),
  );
  const skill = yield* installSkill(userSkillTarget(), contributed);
  const hooks = yield* applyHooks(plans.flat());
  return { skill, hooks };
});

const userHome = (declared: HookUserFile): string => {
  const override = declared.homeEnv === undefined ? undefined : process.env[declared.homeEnv];
  return override !== undefined && override !== '' ? override : join(homedir(), ...declared.folder);
};

export const installForAccount = Effect.fn('harnessInstall.installForAccount')(function* (
  name: HarnessName,
  directory: string | null,
  contributed: SectionCatalog,
  cli: readonly string[],
) {
  const adapter = harnessAdapter(name);
  const surface = adapter.hooks;
  const declared = surface?.user ?? null;
  if (surface === null || declared === null) return yield* installFailure(new Error(`${name} declares no account layer`));
  const home = directory ?? userHome(declared);
  return yield* withFileLock(join(home, '.tagma-install.lock'), 15_000, () =>
    Effect.gen(function* () {
      const sharing = HARNESSES.filter((other) => {
        const user = other.hooks?.user ?? null;
        return user !== null && userFileKey(user) === userFileKey(declared);
      });
      const plans = yield* planHookFiles(
        join(home, declared.file),
        surface.format,
        entriesOf(sharing),
        sharing.flatMap((adapter) => adapter.hooks?.assets ?? []),
      );
      const target = join(home, 'skills', 'tagma');
      const status = yield* skillStatus(target, contributed);
      if (status.state === 'unreadable') return yield* installFailure(new Error(status.reason));
      const mcp =
        adapter.mcp?.file._tag !== 'Home'
          ? undefined
          : yield* Effect.tryPromise({ try: () => declareInto(home, adapter, adapter.mcp!, cli, directory), catch: installFailure });
      if (mcp?.write === 'refused') return yield* installFailure(new Error(mcp.detail));
      const skill = status.state === 'current' ? { target, files: sourceFiles() } : yield* installSkill(target, contributed);
      const hooks = yield* applyHooks(plans);
      return { skill, hooks, mcp };
    }),
  );
}, Effect.mapError(installFailure));

export type HomeIntegration =
  | { readonly harness: HarnessName; readonly installed: UserInstall }
  | { readonly harness: HarnessName; readonly failed: string };

export const installHomes = Effect.fnUntraced(function* (cli: readonly string[]) {
  const contributed = doctrineOf(yield* Doctrine).contributed;
  const installs = yield* InstalledHarnesses;
  const disk = yield* FileSystem.FileSystem;
  const hooked = HARNESSES.flatMap((adapter) => {
    const user = adapter.hooks?.user ?? null;
    return user === null ? [] : [{ adapter, file: join(userHome(user), user.file) }];
  });
  const found = new Set((yield* installs.read).filter((row) => row.binary !== null).map((row) => row.harness));
  const served = yield* Effect.filter(hooked, ({ adapter, file }) =>
    found.has(adapter.harness) ? Effect.succeed(true) : disk.exists(file).pipe(Effect.mapError(installFailure)),
  ).pipe(Effect.map((rows) => rows.map(({ adapter }) => adapter)));
  return yield* Effect.forEach(served, (adapter) =>
    Effect.match(installForAccount(adapter.harness, null, contributed, cli), {
      onSuccess: (installed): HomeIntegration => ({ harness: adapter.harness, installed }),
      onFailure: (failed): HomeIntegration => ({ harness: adapter.harness, failed: failed.detail }),
    }),
  );
});

export const installInto = Effect.fn('harnessInstall.installInto')(function* (
  repoRoot: string,
  lawSection: string,
  declare: (repoRoot: string) => Promise<McpDeclarationWrite[]>,
  contributed: SectionCatalog,
): Effect.fn.Return<RepoInstall, InstallFailed, FileSystem.FileSystem> {
  const agentsPath = join(repoRoot, AGENTS_FILE);
  const claudePath = join(repoRoot, CLAUDE_FILE);
  const agentsPlan = yield* planLawSection(agentsPath, lawSection);
  const claudePlan = yield* planClaudeLaw(claudePath, lawSection);
  const hookPlans = yield* planHooks(repoRoot);
  const agents = { path: agentsPath, write: yield* applyLaw(agentsPlan) };
  const claude = { path: claudePath, write: yield* applyClaudeLaw(claudePlan) };
  const hooks = yield* applyHooks(hookPlans);
  const skill = yield* installSkill(skillTarget(repoRoot), contributed);
  const link = yield* linkSkill(repoRoot);
  const mcp = yield* Effect.tryPromise({ try: () => declare(repoRoot), catch: installFailure });
  return { skill, link, agents, claude, hooks, mcp };
});
