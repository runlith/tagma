import { posix } from 'node:path';
import { Effect, Semaphore } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { CommitShape, type ShapeAsk, type Shaped } from '../change-record/contract/service/shape.js';
import { ProgramRoad } from '../executions/contract/service/programs.js';
import { GraphDirectory } from '../workspace/contract/service/checkouts.js';
import { CommitTrees, type TreeReach } from '../workspace/contract/service/commitTrees.js';
import { Configs } from '../config/contract/service/configs.js';
import { CONFIG_FILE, type FormatEntry } from '../config/contract/wire/config.js';
import { candidatesOf, filtered, globbed, selectorOf } from './selection.js';
import { actorOf, type Entry, PROCESSES, reshapedBy, restored, runStep } from './running.js';

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
      if (ask.skipping) return UNCHANGED(ask, []);
      const { git } = ask;
      const config = yield* configs.read({
        projectId: ask.projectId,
        actor: actorOf(ask.act),
        root: ask.root,
        tree: ask.tree,
        commonDir: ask.commonDir,
      });
      const declaration = config?.footprint ?? [CONFIG_FILE];
      const steps = (config?.format ?? []).filter((step) => step.command.on === 'commit');
      if (steps.length === 0) return UNCHANGED(ask, declaration);
      const candidates = yield* candidatesOf(git, ask.root, ask.base, ask.tree, graphDirectory);
      const plans = steps.map((step) => ({ step, files: globbed(selectorOf(step.command), candidates) }));
      const reach = [...new Set(plans.flatMap((plan) => plan.files))];
      if (reach.length === 0) return UNCHANGED(ask, declaration);
      const original = new Map(candidates.map((one) => [one.path, one.entry] as const));
      const nearby = steps.every((step) => step.command.reads === 'nearby');
      const scope: TreeReach = nearby ? { _tag: 'nearby', paths: reach, uses: usesOf(steps) } : { _tag: 'along', paths: reach };
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
            if (before.size === 0) return UNCHANGED(ask, declaration);
            const tree = yield* trees.staged(git, place);
            return { tree, reshaped: reshapedBy(before, final), skipped: false, declaration } satisfies Shaped;
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
                new GateRefusal('format-cut', 'the format commands ran past their ceiling and were cut, so nothing was committed', [
                  'make the commands faster, or narrow their `files` in tagma.config.ts',
                ]),
              ),
          }),
        );
    }),
  });
});
