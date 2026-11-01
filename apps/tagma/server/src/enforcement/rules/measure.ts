import type { Assembled } from '@tagma/inspection/builtins';
import type { Footprint } from '@tagma/inspection/node/reading';
import type { Unjudged } from '@tagma/inspection/verdict';
import type { ProgramRemeasure } from '@tagma/inspection/program';
import { commitOf, runEnded, troubleOf } from '@runlith/git/repository';
import { Git } from '@runlith/git/Git';
import { Effect, Result } from 'effect';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { measuredRoot } from '../../graph/contract/service/serving.js';
import { actingGit } from '../../platform/git/ownGit.js';
import { type InspectionCoverage, type RuleViolation, reachSaid } from '../contract/wire/enforcement.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Inspections } from '../workers/inspectionLanes.js';
import type { ReachRequest } from '../workers/asks.js';
import { covers } from './reach.js';
import { treeOf } from './measurements.js';

const failed = (reason: string) =>
  new GateRefusal('inspection-failed', reason, [
    'check_rules with the same inspection shows what runs and how long it takes',
    'a program stopped when its life ran out is given more by the life rule that bound it, in whichever list stands it (read_command_rules, write_command_rule)',
  ]);

export const headOf = Effect.fn('enforcement.headOf')(function* (root: string) {
  const git = actingGit(yield* Git, 'enforcement-head');
  const head = yield* Effect.result(commitOf(git, root, 'HEAD'));
  if (Result.isFailure(head)) return yield* failed(`git could not read HEAD in ${root}: ${troubleOf(head.failure)}`);
  if (head.success === null) return yield* failed(`git could not say what HEAD is in ${root}`);
  return head.success;
});

export type CheckoutPlace = { readonly head: string; readonly commonDir: string | undefined; readonly shelf: string | undefined };

const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export const standingAt = Effect.fn('enforcement.standingAt')(function* (root: string, pinned: string) {
  if (COMMIT.test(pinned)) {
    const git = actingGit(yield* Git, 'enforcement-head');
    const answer = yield* runEnded(git, root, ['rev-parse', 'HEAD^{commit}', `${pinned}^{tree}`], undefined, [128]).pipe(
      Effect.mapError((failure) => failed(`git could not read HEAD in ${root}: ${troubleOf(failure)}`)),
    );
    const [head = '', tree = ''] = answer.status === 0 ? answer.stdout.trim().split('\n') : [];
    if (COMMIT.test(head) && COMMIT.test(tree)) return { head, tree };
  }
  return { head: yield* headOf(root), tree: yield* treeOf(root, pinned) };
});

const separately = (root: string): Effect.Effect<CheckoutPlace, GateRefusal<'inspection-failed'>, Git> =>
  Effect.map(headOf(root), (head) => ({ head, commonDir: undefined, shelf: undefined }));

export const placeOf = Effect.fn('enforcement.placeOf')(function* (root: string) {
  const git = actingGit(yield* Git, 'enforcement-head');
  const asked = ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--git-path', 'tagma/measured', 'HEAD^{commit}'];
  return yield* Effect.matchEffect(git.run(asked), {
    onFailure: () => separately(root),
    onSuccess: (answer) => {
      const lines = answer.status === 0 ? answer.stdout.replace(/\n$/, '').split('\n') : [];
      const [commonDir = '', shelf = '', head = ''] = lines;
      return lines.length === 3 && commonDir !== '' && shelf !== '' && COMMIT.test(head)
        ? Effect.succeed<CheckoutPlace>({ head, commonDir, shelf })
        : separately(root);
    },
  });
});

export const movedUnder = Effect.fn('enforcement.movedUnder')(function* (
  root: string,
  from: string,
  to: string,
  places: readonly string[],
  read: ReadonlySet<string> | null,
  packCheck = false,
  inputs: ReadonlySet<string> = new Set(),
  narrow = false,
) {
  const git = actingGit(yield* Git, 'enforcement-head');
  const args = ['diff', '--no-renames', '--name-status', '-z', '--end-of-options', from, to, '--'];
  const answer = yield* runEnded(git, root, args, undefined, []).pipe(
    Effect.mapError((failure) => failed(`git could not compare ${from} and ${to} in ${root}: ${troubleOf(failure)}`)),
  );
  const underReach = covers(places);
  const fields = answer.stdout.split('\0');
  const moved: string[] = [];
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const status = fields[at] ?? '';
    const path = fields[at + 1] ?? '';
    const stood =
      (read === null ? underReach(path) : read.has(path)) ||
      inputs.has(path) ||
      (packCheck && (path === 'package.json' || path.endsWith('/package.json')));
    if (status === 'A' && (stood || (!narrow && underReach(path)))) moved.push(`${path} added`);
    else if (status === 'D' && (stood || (!narrow && underReach(path)))) moved.push(`${path} removed`);
    else if (stood) moved.push(`${path} changed`);
  }
  return moved;
});

type Reading = {
  readonly verdict: { readonly violations: readonly RuleViolation[]; readonly unjudged: readonly Unjudged[] };
  readonly read: readonly string[] | null;
  readonly ms: number;
  readonly footprint?: Footprint;
};

export type ViolationIndex = {
  readonly found: ReadonlyMap<string, RuleViolation>;
  readonly counts: ReadonlyMap<string, number>;
};

export const indexViolations = (violations: readonly RuleViolation[]): ViolationIndex => {
  const found = new Map<string, RuleViolation>();
  const counts = new Map<string, number>();
  for (const violation of violations) {
    if (!found.has(violation.fingerprint)) found.set(violation.fingerprint, violation);
    counts.set(violation.fingerprint, (counts.get(violation.fingerprint) ?? 0) + 1);
  }
  return { found, counts };
};

export type Measured = Reading &
  ViolationIndex & {
    readonly remeasure?: ProgramRemeasure;
    readonly root: string;
    readonly head: string;
    readonly coverage?: readonly InspectionCoverage[];
  };

export const measureReach = Effect.fn('enforcement.measureReach')(function* (
  project: ProjectRow,
  inspection: Assembled,
  places: readonly string[],
  at?: { readonly root: string; readonly head: string },
  priority: 'foreground' | 'background' = 'foreground',
  previous?: ReachRequest['previous'],
  paths?: readonly string[],
) {
  const root = at?.root ?? (yield* measuredRoot(project));
  const head = at?.head ?? (yield* headOf(root));
  return yield* measureAt(root, head, inspection, places, priority, previous, paths).pipe(
    Effect.catchTag('InspectionFailed', (failure) =>
      Effect.fail(failed(`the inspection over ${reachSaid(places)} at ${head} failed (${failure.cause}): ${failure.reason}`)),
    ),
  );
});

export const measureAt = Effect.fn('enforcement.measureAt')(function* (
  root: string,
  head: string,
  inspection: Assembled,
  places: readonly string[],
  priority: 'foreground' | 'background' = 'foreground',
  previous?: ReachRequest['previous'],
  paths?: readonly string[],
) {
  const inspected: Reading = yield* (yield* Inspections).reach({ root, commit: head, inspection, places, previous, paths }, priority);
  const { found, counts } = indexViolations(inspected.verdict.violations);
  const measured: Measured = {
    verdict: inspected.verdict,
    read: inspected.read,
    ms: inspected.ms,
    footprint: inspected.footprint,
    root,
    head,
    found,
    counts,
  };
  return measured;
});

export const reachRefusal = (name: string, base: string) =>
  new GateRefusal(
    'reach-empty',
    `the region of ${name} draws no code under ${base === '' ? 'the repository root' : base}, so the inspection would read nothing`,
    [
      `anchor the region above ${name} to the directories it governs, or move the rule under the region that draws them`,
      "set the inspection's base to a directory the region draws",
    ],
  );
