import { Effect } from 'effect';
import { runGit } from '../platform/git/ownGit.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { DeriveCommand } from '../change-record/contract/wire/derivation.js';
import type { DerivationNeed } from '../change-record/contract/service/shape.js';
import type { DeriveEntry } from '../config/contract/wire/config.js';
import { actorOf, restored, type Running } from './running.js';
import { outsideGraph, selectedPaths, selectionOf } from './selection.js';

type DerivationPlan = {
  readonly key: string;
  readonly command: DeriveCommand;
  readonly paths: readonly string[];
  readonly delivered: boolean;
};

export const derivationEntries = (declared: readonly DeriveEntry[], given: readonly DeriveCommand[]): readonly DeriveEntry[] => [
  ...given.map((command, at) => ({ key: `caller-${at + 1}`, command })),
  ...declared,
];

const touching = (from: readonly string[], paths: readonly string[]): boolean => selectedPaths(selectionOf(from, true), paths).length > 0;

export const derivationsFor = (
  need: DerivationNeed | undefined,
  entries: readonly DeriveEntry[],
  changed: readonly string[],
  available: readonly string[],
  graphDirectory: string,
): readonly DerivationPlan[] => {
  const plans: DerivationPlan[] = [];
  const covered = new Set<string>();
  for (const entry of entries) {
    const { from } = entry.command;
    if (from === undefined ? need === undefined : !touching(from, changed)) continue;
    const names = new Set([...available, ...entry.command.paths.filter((path) => !/[?*\[\]{}!]/.test(path))]);
    const paths = selectedPaths(selectionOf(entry.command.paths, true), [...names]).filter(
      (path) => outsideGraph(path, graphDirectory) && !covered.has(path),
    );
    if (paths.length === 0 && !entry.command.paths.some((path) => /[?*\[\]{}]/.test(path))) continue;
    for (const path of paths) covered.add(path);
    plans.push({ ...entry, paths, delivered: from !== undefined && !touching(from, need?.omitted ?? []) });
  }
  return plans;
};

const outputOf = (stdout: string, stderr: string): string => {
  const text = `${stdout}${stderr}`.trim();
  return text.length === 0 ? 'no output' : text;
};

export const runDerivation = Effect.fn('commitSteps.derive')(function* (
  running: Running,
  at: number,
  plan: DerivationPlan,
  graphDirectory: string,
  claimed: ReadonlySet<string>,
) {
  const { projectId, git, road, pool, root, place, act, job } = running;
  const label = `derivation ${plan.key} (${plan.command.run.join(' ')})`;
  const before = yield* runGit(git, 'commit-derived-base', ['-C', place.dir, 'write-tree'], { env: place.env });
  const ending = yield* pool.withPermits(1)(
    road.run({
      projectId,
      actor: actorOf(act),
      argv: plan.command.run,
      cwd: place.dir,
      policyRoot: root,
      stdin: '',
      env: place.env,
      tool: 'commit-step',
      operation: `commit-derive:${job}:${at}:${crypto.randomUUID()}`,
      subject: `derive ${plan.key}`,
    }),
  );
  yield* runGit(git, 'commit-derived-index', ['-C', place.dir, 'read-tree', before], { env: place.env });
  const unblock = [
    'correct the named derivation command or its environment, then submit again',
    'leave its derived paths out of this landing (paths)',
  ] as const;
  if (ending._tag === 'Unrun')
    return yield* new GateRefusal(
      ending.missing === undefined ? 'derive-failed' : 'derive-missing',
      `${label} could not run: ${ending.said}${ending.missing === undefined ? '' : ` (searched PATH=${ending.missing})`}`,
      unblock,
    );
  if (ending._tag === 'Stopped')
    return yield* new GateRefusal(
      ending.late ? 'derive-cut' : 'derive-failed',
      `${label} stopped: ${ending.said}; ${outputOf('', ending.stderr)}`,
      unblock,
    );
  if (ending.exitCode !== 0)
    return yield* new GateRefusal(
      'derive-failed',
      `${label} exited ${ending.exitCode}; ${outputOf(ending.stdout, ending.stderr)}`,
      unblock,
    );
  const listed = yield* runGit(
    git,
    'commit-derived-files',
    ['-C', place.dir, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { env: place.env },
  );
  const outputs = [
    ...new Set(
      selectedPaths(
        selectionOf(plan.command.paths, true),
        listed.split('\0').filter((path) => path !== '' && outsideGraph(path, graphDirectory) && !claimed.has(path)),
      ),
    ),
  ];
  const missing = plan.paths.filter((path) => !outputs.includes(path));
  if (missing.length > 0) return yield* new GateRefusal('derive-failed', `${label} did not produce ${missing.join(', ')}`, unblock);
  yield* runGit(git, 'commit-derived-take', ['-C', place.dir, 'update-index', '--add', '--remove', '-z', '--stdin'], {
    env: place.env,
    cleans: true,
    stdin: outputs.map((path) => `${path}\0`).join(''),
  });
  yield* restored(git, place, new Set(outputs));
  return outputs;
});
