import * as path from 'node:path';
import { Effect, FileSystem } from 'effect';
import type { ToolCaller } from '@runlith/agent/contracts';
import { everyClaim, ToolFailed } from '@runlith/agent/tool';
import type { ResolvedToolOptions } from '../workspace';
import { pathClaims, resolveWorkspacePath } from '../workspace/runtime';
import { shellCommitDirs, type ShellSweepShape } from '../shellShapes';
import { shellFacts } from '../shellFacts';
import { foreignCause } from '../ToolEdge';
import type { CheckoutBaselines, Place } from '../CheckoutBaselines';
import type { Params } from './tool';

const workdirOf = (resolved: ResolvedToolOptions, params: Params) =>
  params.workdir
    ? resolveWorkspacePath(resolved, path.isAbsolute(params.workdir) ? params.workdir : path.resolve(resolved.cwd, params.workdir))
    : Effect.succeed(resolved.cwd);

export const sweepsShared = Effect.fn('BashTool.sweepsShared')(function* (
  resolved: ResolvedToolOptions,
  baselines: CheckoutBaselines,
  params: Params,
  sweep: ShellSweepShape,
) {
  const swept = (sweep.within ?? []).reduce((dir, one) => path.resolve(dir, one), yield* workdirOf(resolved, params));
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
      within.reduce((dir, one) => path.resolve(dir, one), workdir),
      resolved,
    );
    if ('refused' in found || found.tree === null || found.ours) continue;
    if (yield* resolved.checkoutAt(found.tree).pipe(Effect.mapError(foreignCause))) return found.tree;
  }
  return null;
});

export const commandClaims = Effect.fn('BashTool.commandClaims')(function* (resolved: ResolvedToolOptions, params: Params) {
  const workdir = params.workdir === undefined ? resolved.cwd : path.resolve(resolved.cwd, params.workdir);
  const facts = shellFacts(params.command, workdir);
  if (facts.readsOnly) return everyClaim('read');
  const unknown = (part: (typeof facts.parts)[number]) =>
    part.named === null || part.implicit.length > 0 || (!part.readsOnly && part.named.length === 0);
  if (facts.parts.some(unknown)) return everyClaim('write');
  const named = facts.parts.flatMap((part) => (part.readsOnly ? [] : (part.named ?? [])));
  return [...everyClaim('read'), ...(yield* pathClaims(resolved, named, 'write', true))];
});

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
  const writes = !facts.readsOnly;
  let place: Place | null = null;
  let refused: string | null = 'refused' in real ? real.refused : null;
  let elsewhere: string | null = null;
  if (measuring && refused === null) {
    const found = yield* baselines.place(workdir, resolved);
    if ('refused' in found) refused = found.refused;
    else if (found.ours) place = found;
    else {
      elsewhere = found.tree;
      const own = writes ? yield* baselines.place(resolved.cwd, resolved) : null;
      const reached = own === null || 'refused' in own || !own.ours ? null : own;
      const names = (root: string): boolean => params.command.includes(`${root}/`) || params.command.endsWith(root);
      place =
        reached !== null && (found.tree === null || names(resolved.cwd) || (reached.tree !== null && names(reached.tree)))
          ? reached
          : found;
    }
  }
  return { workdir, place, refused, measuring, facts, elsewhere };
});

export const commandTime = (resolved: ResolvedToolOptions, params: Params, caller: ToolCaller, workdir: string) =>
  resolved.commandTimes
    .resolve({ waitMs: params.waitMs, lifeMs: params.lifeMs }, caller, workdir)
    .pipe(
      Effect.mapError((failure) => new ToolFailed({ reason: `The command rules could not be read, so nothing ran: ${failure.reason}` })),
    );
