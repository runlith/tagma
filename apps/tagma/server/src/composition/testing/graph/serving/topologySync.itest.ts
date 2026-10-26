import { expect } from 'bun:test';
import { dirname, join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Schedule } from 'effect';
import { eq } from 'drizzle-orm';
import { GraphStore } from '../../../../platform/contract/service/store.js';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { block } from '../../../../graph/store/tables.js';
import { runGit } from '../../../../platform/git/ownGit.js';
import { servingLayer, withServing } from './fixture.js';

layer(servingLayer, { excludeTestServices: true })('standing topology', (it) => {
  it.effect('a merged project branch reaches the already served canonical graph', () =>
    withServing(({ demo, pool, served: canonical, projectId, repo }) =>
      Effect.gen(function* () {
        const wt = join(dirname(repo), 'feature');
        const git = demo.graph.git;
        yield* runGit(git, 'branch', ['-C', repo, 'worktree', 'add', '-b', 'feature', wt, 'main']);
        const served = yield* pool.resolve({ projectId, cwd: wt });
        const made = yield* demo
          .as(
            'topology',
            Context.get(served.context, Blocks).create({
              projectId,
              tags: ['idea'],
              title: 'Branch Note',
              body: 'written on the branch',
            }),
          )
          .pipe(Effect.provide(served.context));
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(join(wt, 'feature.txt'), 'feature\n');
        yield* runGit(git, 'add', ['-C', wt, 'add', '-A']);
        yield* runGit(git, 'commit', ['-C', wt, 'commit', '-m', 'feature']);
        const db = Context.get(canonical.context, GraphStore).db;
        expect(yield* db.select().from(block).where(eq(block.uuid, made.uuid))).toEqual([]);
        yield* runGit(git, 'merge', ['-C', repo, 'merge', '--no-ff', '-m', 'merge feature', 'feature']);
        const reached = yield* Effect.andThen(canonical.fresh(), db.select().from(block).where(eq(block.uuid, made.uuid)).get()).pipe(
          Effect.repeat({ schedule: Schedule.spaced('20 millis'), until: (row) => row !== undefined }),
        );
        expect(reached).toMatchObject({ uuid: made.uuid, body: 'written on the branch' });
      }),
    ),
  );
});
