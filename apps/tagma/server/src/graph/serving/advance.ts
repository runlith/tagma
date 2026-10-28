import { Effect } from 'effect';
import { Background } from '../../platform/contract/service/background.js';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { meta } from '../store/tables.js';
import { inArray } from 'drizzle-orm';
import type { Git } from '@runlith/git/Git';
import { unmergedPaths } from '../../platform/git/unmerged.js';
import { Tags } from '../contract/service/vocabulary.js';
import type { FormatHold } from '../contract/service/serving.js';
import type { ProjectPolicyRow } from '../contract/wire/serving.js';
import { FORMAT_FILE } from '../contract/wire/storage.js';
import { treeBranch } from '../tree/batch.js';
import { TreeCommits } from '../tree/commits.js';
import { absorbMirror, indexMirror } from '../tree/mirror.js';
import { treeHeadStamp } from '../tree/stamp.js';
import { projectToTree } from '../tree/projection.js';
import { scanTree, type TreeScan } from '../tree/scan.js';
import type { ShadowGit } from '../tree/shadow.js';
import type { GraphSteps } from '../contract/service/steps.js';

const mirrorStep = (id: string): string => `graph-step:${id}`;
const steppingMirror = writes('Graph.advanceTree.mirrorStep', [meta]);

const midOperation = Effect.fnUntraced(function* (git: Git['Service'], treeRoot: string) {
  const branch = yield* treeBranch(treeRoot);
  if ('held' in branch && branch.held === 'operation') return true;
  return (yield* unmergedPaths(git, treeRoot)).length > 0;
});

export const advanceTree = Effect.fn('Graph.advanceTree')(function* (input: {
  readonly project: ProjectPolicyRow;
  readonly treeRoot: string;
  readonly stealth?: string | null;
  readonly checkout?: string;
  readonly shadow: ShadowGit | null;
  readonly git: Git['Service'];
  readonly format: FormatHold;
  readonly steps: GraphSteps['Service'];
  readonly fromTree: boolean;
  readonly scan?: TreeScan;
}) {
  yield* Effect.annotateCurrentSpan('graph.steps.passed', false);
  if (input.format.holds()) return false;
  const store = yield* GraphStore;
  const mirrored =
    input.steps.mirror.length === 0
      ? []
      : yield* store.db
          .select({ id: meta.value })
          .from(meta)
          .where(inArray(meta.key, input.steps.mirror.map(mirrorStep)));
  const pending = input.steps.after(
    input.format.reached(),
    mirrored.map((row) => row.id),
  );
  if (pending.length === 0) return false;
  const ids = pending.map((step) => step.id).join(' · ');
  if (yield* midOperation(input.git, input.treeRoot)) {
    yield* Effect.logWarning(`${input.treeRoot} stands mid-operation, so its graph steps wait until it concludes: ${ids}`);
    return false;
  }
  yield* (yield* Background).run(
    {
      title: `Graph format: ${input.project.name} · ${input.checkout ?? input.treeRoot}`,
      reason: 'Reading graph format',
      total: pending.length + 1,
    },
    (progress) =>
      Effect.gen(function* () {
        if (!input.fromTree) yield* absorbMirror(input.scan ?? (yield* scanTree(input.treeRoot, input.stealth ?? null)), input.project.id);
        for (const step of pending) {
          yield* progress.stage(step.id);
          yield* step.run(input.project);
          if (step.mirror)
            yield* store.transaction(steppingMirror, () =>
              store.db
                .insert(meta)
                .values({ key: mirrorStep(step.id), value: step.id })
                .onConflictDoUpdate({ target: meta.key, set: { value: step.id } }),
            );
          yield* progress.advance();
        }
        yield* progress.stage('Publishing graph format');
        yield* (yield* Tags).forget(input.project.id);
        yield* projectToTree({ projectId: input.project.id, treeRoot: input.treeRoot, stealth: input.stealth ?? null });
        yield* indexMirror(input.project.id);
        input.format.reach();
        yield* input.format.stamp;
        const committed = input.shadow === null ? null : yield* input.shadow.commitAct(input.treeRoot, `graph steps: ${ids}`);
        if (committed !== null) yield* treeHeadStamp().writeStamp(committed);
        const commits = yield* TreeCommits;
        if (commits !== undefined) yield* commits.carry([FORMAT_FILE]);
        yield* (yield* Tags).forget(input.project.id);
        yield* progress.advance();
      }),
  );
  yield* Effect.logInfo(`${input.treeRoot} passed graph steps: ${ids}`);
  yield* Effect.annotateCurrentSpan('graph.steps.passed', true);
  return true;
});
