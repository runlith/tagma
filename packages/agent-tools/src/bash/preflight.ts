import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { Effect, FileSystem } from 'effect';
import type { ToolCaller } from '@runlith/agent/contracts';
import { everyClaim, ToolFailed } from '@runlith/agent/tool';
import type { ResolvedToolOptions } from '../workspace';
import { pathClaims, resolveWorkspacePath } from '../workspace/runtime';
import { shellCommitDirs, type ShellSweepShape } from '../shellShapes';
import { shellFacts, shellPlaces } from '../shellFacts';
import { foreignCause } from '../ToolEdge';
import type { CheckoutBaselines, Place } from '../CheckoutBaselines';
import type { ShellTree } from '../ShellRun';
import { globSplit, literalGlob, type CommandFacts, type CommandPath, type Unplaced } from '../WorkspaceChanges';
import type { Params } from './tool';

const workdirOf = (resolved: ResolvedToolOptions, params: Params) =>
  params.workdir
    ? resolveWorkspacePath(resolved, isAbsolute(params.workdir) ? params.workdir : resolve(resolved.cwd, params.workdir))
    : Effect.succeed(resolved.cwd);

export const sweepsShared = Effect.fn('BashTool.sweepsShared')(function* (
  resolved: ResolvedToolOptions,
  baselines: CheckoutBaselines,
  params: Params,
  sweep: ShellSweepShape,
) {
  const swept = (sweep.within ?? []).reduce((dir, one) => resolve(dir, one), yield* workdirOf(resolved, params));
  const checkout = yield* resolved.checkout(swept).pipe(Effect.mapError(foreignCause));
  if (checkout !== 'shared') return false;
  const found = yield* baselines.place(swept, resolved);
  return 'refused' in found || found.ours;
});

export const commitElsewhere = Effect.fn('BashTool.commitElsewhere')(function* (
  resolved: ResolvedToolOptions,
  baselines: CheckoutBaselines,
  params: Params,
) {
  const commits = shellCommitDirs(params.command);
  if (commits.length === 0) return null;
  const workdir = yield* workdirOf(resolved, params);
  for (const within of commits) {
    const found = yield* baselines.place(
      within.reduce((dir, one) => resolve(dir, one), workdir),
      resolved,
    );
    if ('refused' in found || found.tree === null || found.ours) continue;
    if (yield* resolved.checkoutAt(found.tree).pipe(Effect.mapError(foreignCause))) return found.tree;
  }
  return null;
});

export const commandClaims = Effect.fn('BashTool.commandClaims')(function* (resolved: ResolvedToolOptions, params: Params) {
  const workdir = params.workdir === undefined ? resolved.cwd : resolve(resolved.cwd, params.workdir);
  const facts = shellFacts(params.command, workdir);
  if (facts.readsOnly) return everyClaim('read');
  const unknown = (part: (typeof facts.parts)[number]) =>
    part.named === null ||
    part.named.some((path) => typeof path !== 'string') ||
    part.implicit.length > 0 ||
    (!part.readsOnly && part.named.length === 0);
  if (facts.parts.some(unknown)) return everyClaim('write');
  const named = facts.parts.flatMap((part) =>
    part.readsOnly ? [] : (part.named ?? []).filter((path): path is string => typeof path === 'string'),
  );
  return [...everyClaim('read'), ...(yield* pathClaims(resolved, named, 'write', true))];
});

const sessionTree = Effect.fn('BashTool.sessionTree')(function* (
  resolved: ResolvedToolOptions,
  baselines: CheckoutBaselines,
  found: Place,
) {
  const own = found.ours ? found : yield* baselines.place(resolved.cwd, resolved);
  return 'refused' in own || !own.ours ? null : own.tree;
});

const ownMeasured = (params: Params, resolved: ResolvedToolOptions, found: Place, own: string): boolean => {
  if (found.ours) return true;
  const names = (root: string): boolean => params.command.includes(`${root}/`) || params.command.endsWith(root);
  return found.tree === null || names(resolved.cwd) || names(own);
};

const spelledFacts = Effect.fn('BashTool.spelledFacts')(function* (facts: CommandFacts) {
  const fs = yield* FileSystem.FileSystem;
  const directories = new Map<string, string | Unplaced>();
  const unplaced = new Map<string, Unplaced>();
  const physical = Effect.fnUntraced(function* (directory: string): Effect.fn.Return<string | Unplaced> {
    const held = directories.get(directory);
    if (held !== undefined) return held;
    const real = yield* fs.realPath(directory).pipe(
      Effect.map((path): string | Unplaced | null => path),
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
      Effect.catchTag('PlatformError', (error) =>
        Effect.succeed({ path: directory, reason: `its directory could not be resolved: ${error.reason._tag}` }),
      ),
    );
    const parent = dirname(directory);
    const above = real !== null || parent === directory ? null : yield* physical(parent);
    const spelled = real ?? (above === null ? directory : typeof above === 'string' ? join(above, basename(directory)) : above);
    directories.set(directory, spelled);
    return spelled;
  });
  const spell = Effect.fnUntraced(function* (path: CommandPath): Effect.fn.Return<CommandPath> {
    const { base, rest } = typeof path === 'string' ? { base: dirname(path), rest: basename(path) } : globSplit(path.glob);
    if (typeof path === 'string' && path === base) return path;
    const spelled = yield* physical(base);
    if (typeof spelled !== 'string') {
      unplaced.set(spelled.path, spelled);
      return path;
    }
    if (typeof path === 'string') return join(spelled, rest);
    return { glob: `${literalGlob(spelled)}${spelled.endsWith('/') ? '' : '/'}${rest}` };
  });
  const parts = yield* Effect.forEach(facts.parts, (part) =>
    part.readsOnly || part.named === null
      ? Effect.succeed(part)
      : Effect.map(Effect.forEach(part.named, spell), (named) => ({ ...part, named })),
  );
  return { facts: { ...facts, parts }, unplaced: [...unplaced.values()] };
});

const reachedBy = (facts: CommandFacts, command: string, workdir: string): readonly CommandPath[] => {
  const seen = new Set<string>();
  const reached: CommandPath[] = [];
  for (const path of [...shellPlaces(command, workdir), ...facts.parts.flatMap((part) => (part.readsOnly ? [] : (part.named ?? [])))]) {
    const key = typeof path === 'string' ? path : `\0${path.glob}`;
    if (seen.has(key)) continue;
    seen.add(key);
    reached.push(path);
  }
  return reached;
};

export const preflight = Effect.fn('BashTool.preflight')(function* (
  resolved: ResolvedToolOptions,
  params: Params,
  baselines: CheckoutBaselines,
) {
  const workdir = yield* workdirOf(resolved, params);
  const measuring = resolved.changes !== undefined;
  const fs = yield* FileSystem.FileSystem;
  const real = measuring
    ? yield* fs.realPath(workdir).pipe(
        Effect.map((path): { readonly path: string } | { readonly refused: string } => ({ path })),
        Effect.catchTag('PlatformError', (error) =>
          Effect.succeed({ refused: `the working directory ${workdir} could not be resolved: ${error.reason._tag}` }),
        ),
      )
    : { path: workdir };
  const facts = shellFacts(params.command, 'path' in real ? real.path : workdir);
  const unmeasured = { workdir, trees: [], measuring, facts, ran: null, unplaced: [] };
  if (!measuring) return { ...unmeasured, refused: null };
  if ('refused' in real) return { ...unmeasured, refused: real.refused };
  const found = yield* baselines.place(workdir, resolved);
  if ('refused' in found) return { ...unmeasured, refused: found.refused };
  const ran = found.ours ? null : found.tree;
  if (facts.readsOnly && !found.ours) return { ...unmeasured, refused: null, ran };
  const own = yield* sessionTree(resolved, baselines, found);
  const spelled = facts.readsOnly ? { facts, unplaced: [] } : yield* spelledFacts(facts);
  const checkouts = resolved.changes?.checkouts;
  const reached =
    !facts.readsOnly && checkouts !== undefined
      ? yield* checkouts(reachedBy(spelled.facts, params.command, real.path))
      : { trees: [], unplaced: [] };
  const trees = new Map<string, ShellTree>();
  if (own !== null && ownMeasured(params, resolved, found, own)) trees.set(own, { tree: own, ours: true });
  for (const tree of reached.trees) if (!trees.has(tree)) trees.set(tree, { tree, ours: tree === own });
  const unplaced = [...spelled.unplaced, ...reached.unplaced];
  return { workdir, trees: [...trees.values()], refused: null, measuring, facts: spelled.facts, ran, unplaced };
});

export const commandTime = (resolved: ResolvedToolOptions, params: Params, caller: ToolCaller, workdir: string) =>
  resolved.commandTimes
    .resolve({ waitMs: params.waitMs, lifeMs: params.lifeMs }, caller, workdir)
    .pipe(
      Effect.mapError((failure) => new ToolFailed({ reason: `The command rules could not be read, so nothing ran: ${failure.reason}` })),
    );
