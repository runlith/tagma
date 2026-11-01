import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { dirname, join } from 'node:path';
import { Context, Effect, FileSystem } from 'effect';
import { graphFixture } from '../graphFixture.js';
import { composed, shEffect } from '../finishingFixture.js';
import { checkSubjectOf } from '../composed.js';
import { MINE } from '../checkoutFixture.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { type ProgramLaunch, ProgramRoad } from '../../../executions/contract/service/programs.js';
import { localRoad } from '../../../executions/testing/road.js';
import { checksOver, enforcementApplied, enforcementBaseOf, quiet, withLanes, workerLanes } from '../../../enforcement/testing/wiring.js';
import { actChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { MeasuredCheckout } from '../../../graph/contract/service/serving.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';

const KEY = 'marker';

const CHECK = `
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export default {
  marker: async ({ tree, base }) => {
    if (base === null) return { tree: { findings: [] } };
    if (readFileSync(join(process.cwd(), 'marker'), 'utf8') !== (await tree.read('marker'))) {
      console.error('the working tree holds another marker than the judged tree');
      process.exit(1);
    }
    return { tree: { findings: [] }, base: { findings: [] } };
  },
};
`;

const put = Effect.fn('testing.mergeProgram.put')(function* (dir: string, path: string, text: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(dirname(join(dir, path)), { recursive: true });
  yield* files.writeFileString(join(dir, path), text);
});

const committed = Effect.fnUntraced(function* (dir: string, message: string) {
  yield* shEffect(dir, ['add', '-A']);
  yield* shEffect(dir, ['commit', '-q', '-m', message]);
});

it.live('a gated program that reads the working tree judges a merge over the merged files, so the merge lands', () =>
  Effect.gen(function* () {
    const world = graphFixture();
    const base = (yield* Effect.acquireRelease(world.openEffect(), () => Effect.orDie(world.releaseEffect))).effects;
    const workers = yield* Effect.acquireRelease(Effect.sync(workerLanes), (lanes) => Effect.sync(() => lanes.close()));
    const launches: ProgramLaunch[] = [];
    const served = () => withLanes(base.context, workers).pipe(Context.add(ProgramRoad, localRoad(launches)));
    return yield* Effect.gen(function* () {
      const checks = actChecks(checksOver({ graphOf: () => Effect.succeed(served()) }), 'merge_worktree');
      const { finishing, make, project, projectId } = yield* composed(
        base,
        makeMachineWorld(() => null),
        { before: checks.before },
      );
      const caller = { _tag: 'Thread' as const, threadId: ThreadId.make(MINE), projectId };
      yield* put(project, 'tools/check.js', CHECK);
      yield* put(project, 'marker', 'one\n');
      yield* committed(project, 'a marker and its check');
      base.described.set(KEY, { program: 'tools/check.js', name: KEY, concern: 'code', needs: [], params: {} });
      const under = yield* base.graph.blocks.rootBlockOf(projectId);
      const made = yield* base.graph.blocks.create({ projectId, parentId: under.id, tags: ['rule'], title: 'The marker holds' });
      const row = yield* base.graph.blocks.blockById(made.id);
      yield* enforcementApplied(row, {
        strictness: 'gate',
        on: [{ op: 'merge_worktree', phase: 'before' }],
        inspection: KEY,
        caller,
        subjectOf: checkSubjectOf,
        base: yield* enforcementBaseOf(row),
      }).pipe(
        Effect.provideService(MeasuredCheckout, { projectId, path: project }),
        Effect.provideContext(quiet(workers)),
        Effect.provide(served()),
      );

      const side = yield* make('marked');
      yield* put(side.path, 'marker', 'two\n');
      yield* committed(side.path, 'another marker');
      launches.length = 0;
      const merged = yield* finishing.merge(projectId, side.rootId, { caller });
      expect(launches.map((launch) => launch.cwd).filter((cwd) => cwd !== project)).not.toEqual([]);
      expect(merged.base.head).toBe(yield* shEffect(project, ['rev-parse', 'HEAD']));
      expect(yield* shEffect(project, ['show', 'HEAD:marker'])).toBe('two');
    }).pipe(Effect.provide(base.context));
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
