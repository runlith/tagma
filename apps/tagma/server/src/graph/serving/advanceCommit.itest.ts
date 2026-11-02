import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FiberSet, Queue } from 'effect';
import { TestClock } from 'effect/testing';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { runGit } from '../../platform/git/ownGit.js';
import { CHECKOUT_DIRECTORY } from '../contract/wire/storage.js';
import { shippedSteps } from '../steps/sequence.js';
import { TreeCommits, treeCommits } from '../tree/commits.js';
import { commitJournal } from '../tree/message.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { projectToTree } from '../tree/projection.js';
import { openFormat } from './format.js';
import { advanceTree } from './advance.js';

layer(demoGraphLayer(), { excludeTestServices: true })('graph format delivery', (it) => {
  it.effect('a team checkout whose tree passes graph steps commits them onto its branch', () =>
    withDemo(({ graph, projectId, fixture }) =>
      Effect.gen(function* () {
        const checkout = yield* fixture.directory('advance-team');
        const treeRoot = join(checkout, CHECKOUT_DIRECTORY);
        yield* runGit(graph.git, 'init', ['init', '-q', '-b', 'main'], { cwd: checkout });
        yield* projectToTree({ projectId, treeRoot });
        yield* runGit(graph.git, 'add', ['add', '-A'], { cwd: checkout });
        yield* runGit(
          graph.git,
          'commit',
          ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'the tree before its steps'],
          { cwd: checkout },
        );
        const project = (yield* graph.projectPolicy.read([projectId])).get(projectId)!;
        const format = yield* openFormat(treeRoot, shippedSteps);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const landed = yield* Queue.unbounded<void>();
            const fork = yield* FiberSet.makeRuntime<never, void, never>();
            const commits = treeCommits({
              git: graph.git,
              checkout,
              treeRoot,
              journal: commitJournal({
                store: graph.graphStore,
                tags: graph.tags,
                identity: testSessionIdentity,
                projectId,
                scope: 'team',
              }),
              permit: (effect) => effect,
              policy: Effect.succeed('auto'),
              fork: (work) => fork(Effect.andThen(work, Queue.offer(landed, undefined))),
            });
            expect(
              yield* advanceTree({ project, treeRoot, shadow: null, git: graph.git, format, steps: shippedSteps, fromTree: false }).pipe(
                Effect.provideService(TreeCommits, commits),
              ),
            ).toBe(true);
            yield* TestClock.adjust('10 minutes');
            yield* Queue.take(landed);
          }).pipe(Effect.provide(TestClock.layer())),
        );
        expect(yield* runGit(graph.git, 'status', ['status', '--porcelain', '--', CHECKOUT_DIRECTORY], { cwd: checkout })).toBe('');
      }),
    ),
  );
});
