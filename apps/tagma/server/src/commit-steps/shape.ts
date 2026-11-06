import { posix } from 'node:path';
import { Effect, Semaphore } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { CommitShape, type DerivationNeed, type ShapeAsk, type Shaped } from '../change-record/contract/service/shape.js';
import { ProgramRoad } from '../executions/contract/service/programs.js';
import { GraphDirectory } from '../workspace/contract/service/checkouts.js';
import { CommitTrees, WHOLE_TREE, type TreeReach } from '../workspace/contract/service/commitTrees.js';
import { Configs } from '../config/contract/service/configs.js';
import { CONFIG_FILE, type FormatEntry } from '../config/contract/wire/config.js';
import { candidatesOf, filtered, globbed, outsideGraph, selectorOf } from './selection.js';
import { actorOf, type Entry, entriesAt, PROCESSES, reshapedBy, restored, runStep, shasOf } from './running.js';
import { derivationEntries, derivationsFor, runDerivation } from './deriving.js';
import { runGit } from '../platform/git/ownGit.js';

const UNCHANGED = (ask: ShapeAsk, declaration: readonly string[]): Shaped => ({
  tree: ask.tree,
  reshaped: [],
  skipped: ask.skipping,
  declaration,
});

const usesOf = (steps: readonly FormatEntry[]): readonly string[] => [
  ...new Set(
    steps.flatMap(({ command }) =>
      command.run.filter((arg) => {
        if (arg.startsWith('-') || posix.isAbsolute(arg)) return false;
        const path = posix.normalize(arg);
        return path !== '.' && path !== '..' && !path.startsWith('../');
      }),
    ),
  ),
];

export const makeCommitShape = Effect.gen(function* () {
  const trees = yield* CommitTrees;
  const road = yield* ProgramRoad;
  const configs = yield* Configs;
  const graphDirectory = yield* GraphDirectory;
  const pool = yield* Semaphore.make(PROCESSES);

  return CommitShape.of({
    shape: Effect.fn('CommitShape.shape')(function* (ask) {
      if (ask.skipping && ask.derivation === undefined) return UNCHANGED(ask, []);
      const { git } = ask;
      let need: DerivationNeed | undefined;
      if (ask.skipping) {
        need = ask.derivation === undefined ? undefined : yield* ask.derivation(true);
        if (need === undefined) return UNCHANGED(ask, []);
      }
      const config = yield* configs.read({
        projectId: ask.projectId,
        actor: actorOf(ask.act),
        root: ask.root,
        tree: ask.tree,
        commonDir: ask.commonDir,
      });
      const declaration = config?.footprint ?? [CONFIG_FILE];
      const entries = derivationEntries(config?.derive ?? [], ask.derive ?? []);
      const declared = entries.length > 0;
      if (!ask.skipping) need = ask.derivation === undefined ? undefined : yield* ask.derivation(declared);
      const steps = ask.skipping || ask.merging === true ? [] : (config?.format ?? []).filter((step) => step.command.on === 'commit');
      const changed =
        ask.skipping || !entries.some((entry) => entry.command.from !== undefined)
          ? []
          : (yield* runGit(git, 'commit-derived-inputs', [
              '-C',
              ask.root,
              'diff-tree',
              '-r',
              '-z',
              '--name-only',
              '--no-renames',
              ask.base,
              ask.tree,
            ]))
              .split('\0')
              .filter((path) => path !== '');
      const available =
        !declared || (need === undefined && changed.length === 0)
          ? []
          : (yield* runGit(git, 'commit-derived-outputs', ['-C', ask.root, 'ls-tree', '-r', '--name-only', '-z', ask.tree]))
              .split('\0')
              .filter((path) => path !== '' && outsideGraph(path, graphDirectory));
      const derivations = derivationsFor(need, entries, changed, available, graphDirectory);
      if (steps.length === 0 && derivations.length === 0) return UNCHANGED(ask, declaration);
      const candidates = steps.length === 0 ? [] : yield* candidatesOf(git, ask.root, ask.base, ask.tree, graphDirectory);
      const plans = steps.map((step) => ({ step, files: globbed(selectorOf(step.command), candidates) }));
      const reach = [
        ...new Set([
          ...plans.flatMap((plan) => plan.files),
          ...derivations.flatMap((plan) => plan.paths),
          ...(derivations.length === 0 ? [] : (need?.paths ?? [])),
        ]),
      ];
      if (reach.length === 0 && derivations.length === 0) return UNCHANGED(ask, declaration);
      const original = new Map(candidates.map((one) => [one.path, one.entry] as const));
      const nearby = derivations.length === 0 && steps.every((step) => step.command.reads === 'nearby');
      const scope: TreeReach = nearby
        ? { _tag: 'nearby', paths: reach, uses: usesOf(steps) }
        : derivations.length > 0
          ? WHOLE_TREE
          : { _tag: 'along', paths: reach };
      let phase: 'format' | 'derive' = steps.length === 0 ? 'derive' : 'format';
      const deriving = () => phase === 'derive';
      return yield* trees
        .within(git, ask.root, ask.gitDir, ask.tree, scope, (place) =>
          Effect.gen(function* () {
            const excluded = yield* filtered(git, place, reach);
            const before = new Map<string, Entry>();
            const final = new Map<string, Entry>();
            for (const [at, plan] of plans.entries()) {
              const files = plan.files.filter((path) => !excluded.has(path));
              if (files.length === 0) continue;
              for (const [path, entry] of yield* runStep(
                { projectId: ask.projectId, git, road, pool, root: ask.root, place, act: ask.act, job: ask.job },
                at,
                plan.step,
                files,
              ))
                final.set(path, entry);
              yield* restored(git, place, new Set(files));
              for (const path of files) {
                const first = original.get(path);
                if (first !== undefined) before.set(path, first);
              }
            }
            phase = 'derive';
            const derived = new Set<string>();
            const delivered = new Set<string>();
            const taken = new Set<string>();
            for (const [at, plan] of derivations.entries())
              for (const path of yield* runDerivation(
                { projectId: ask.projectId, git, road, pool, root: ask.root, place, act: ask.act, job: ask.job },
                at,
                plan,
                graphDirectory,
                taken,
              )) {
                taken.add(path);
                (plan.delivered ? delivered : derived).add(path);
              }
            if (before.size === 0 && taken.size === 0) return UNCHANGED(ask, declaration);
            const outputs = [...delivered].filter((path) => !before.has(path));
            const was = yield* entriesAt(git, ask.root, ask.tree, outputs);
            for (const path of outputs) if (!was.has(path)) derived.add(path);
            const now = yield* shasOf(git, place, outputs);
            const tree = yield* trees.staged(git, place);
            return {
              tree,
              reshaped: [...reshapedBy(before, final), ...reshapedBy(was, now)].filter((one) => !derived.has(one.path)),
              skipped: ask.skipping,
              declaration,
              derived: [...derived],
            } satisfies Shaped;
          }),
        )
        .pipe(
          Effect.catchTags({
            HoldStalled: () =>
              Effect.fail(
                new GateRefusal(
                  'landing-busy',
                  "the commit steps waited for the checkout's commit tree and it stayed in use, so nothing was committed",
                  ['ask again once the checkout has settled'],
                ),
              ),
            HoldCut: () =>
              Effect.fail(
                deriving()
                  ? new GateRefusal('derive-cut', 'the derivation ran past the commit tree ceiling and was cut, so nothing was committed', [
                      'make the derivation faster, then submit again',
                      'leave its output paths out of this landing',
                    ])
                  : new GateRefusal('format-cut', 'the format commands ran past their ceiling and were cut, so nothing was committed', [
                      'make the commands faster, or narrow their `files` in tagma.config.ts',
                    ]),
              ),
          }),
        );
    }),
  });
});
