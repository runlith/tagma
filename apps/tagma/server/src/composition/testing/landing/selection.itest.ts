import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Effect, FileSystem, Path } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { demoGraphLayer, gitEffect, withDemo } from '../graphFixture.js';
import { Git } from '@runlith/git/Git';
import { lineWrites } from '../../lineWrites.js';
import { selectCheckout } from '../../../change-record/prepared/selection.js';
import { Holdings } from '../../../change-record/contract/service/holdings.js';
import { servedOver } from '../../../change-record/testing/doubles.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { FileRoots } from '../../../workspace/contract/service/roots.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { aimedAt, atPlace, inWorkspace } from '../../../invocation/testing/call.js';
import { checkoutPaths, coveredWorkspace, gitCheckoutRows } from '../../../workspace/testing/doubles.js';
layer(demoGraphLayer({ repos: ['target'] }), { excludeTestServices: true })('checkout selection', (it) => {
  it.effect('submit preparation selects actual holdings and refuses to mix two checkouts of one project', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { store, units, projects } = demo.graph;
        const liveGit = yield* Git;
        const files = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const target = demo.project('target');
        const side = realpathSync(yield* demo.fixture.directory('side'));
        yield* files.writeFileString(join(target.root, 'held.txt'), 'base\n');
        yield* gitEffect(target.root, ['add', 'held.txt']);
        yield* gitEffect(target.root, ['commit', '-q', '-m', 'base']);
        yield* gitEffect(target.root, ['worktree', 'add', '-q', '-b', 'side', side]);
        const { roots, coverage } = yield* coveredWorkspace({ namespaceId: NamespaceId.make('selection'), projects, git: liveGit });
        yield* coverage.adopt(target.id, side);
        const paths = yield* checkoutPaths(coverage, projects);
        const served = yield* servedOver({
          store,
          units,
          git: liveGit,
          roots,
          coverage,
          paths,
          checkouts: yield* gitCheckoutRows(liveGit, roots, files, yield* Effect.scope),
        });
        const caller = {
          actor: {
            kind: 'thread' as const,
            threadId: 'writer',
            projectId: demo.projectId,
            principalId: 'owner',
            session: { harness: 'tagma', key: 'writer' },
          },
          files: null,
        };
        const write = Effect.fnUntraced(function* (root: string, before: string, after: string) {
          const placed = yield* paths.placeAcross(root);
          if (placed === null) return yield* Effect.die('the checkout is absent');
          const result = yield* served.intake.land(
            { projectId: demo.projectId, holder: { kind: 'thread', thread: 'writer' } },
            [
              {
                path: join(root, 'held.txt'),
                origin: 'edit',
                before: contentDigest(before),
                after: contentDigest(after),
                beforeText: before,
                afterText: after,
                hunk: workspaceChangeHunk(before, after),
                at: new Date(yield* Clock.currentTimeMillis),
              },
            ],
            lineWrites.replace({ root, path: 'held.txt', before, after }, Effect.succeed(true)),
          );
          yield* served.judges.moved(RootId.make(placed.checkout), ['held.txt']);
          return result;
        });
        const select = (checkout?: string) =>
          selectCheckout({ checkout }, caller).pipe(
            inWorkspace(null),
            Effect.provideService(Holdings, served.judges),
            Effect.provideService(CheckoutPaths, paths),
            Effect.provideService(FileRoots, roots),
          );
        expect(yield* write(target.root, 'base\n', 'main\n')).toEqual({ _tag: 'written', kept: true });
        expect(yield* select()).toEqual({ projectId: target.id, checkout: target.root, branch: null });
        expect(yield* write(side, 'base\n', 'side\n')).toEqual({ _tag: 'written', kept: true });
        expect(yield* Effect.flip(select())).toMatchObject({ code: 'multiple-checkouts' });
        expect(yield* select(side)).toEqual({ projectId: target.id, checkout: side, branch: null });
        expect(
          yield* selectCheckout({ project: target.id }, caller).pipe(
            inWorkspace(null),
            atPlace({ projectId: target.id, checkout: side, branch: null }),
            aimedAt({ project: String(target.id), cwd: undefined, branch: undefined }),
            Effect.provideService(Holdings, served.judges),
            Effect.provideService(CheckoutPaths, paths),
            Effect.provideService(FileRoots, roots),
          ),
        ).toEqual({ projectId: target.id, checkout: target.root, branch: null });
        expect(yield* write(target.root, 'main\n', 'base\n')).toEqual({ _tag: 'written', kept: true });
        expect(yield* select()).toEqual({ projectId: target.id, checkout: side, branch: null });
        yield* files.writeFileString(join(target.root, '.gitignore'), 'ignored.txt\n');
        expect(
          yield* served.intake.land(
            { projectId: demo.projectId, holder: { kind: 'thread', thread: 'writer' } },
            [
              {
                path: join(target.root, 'ignored.txt'),
                origin: 'write',
                before: contentDigest(''),
                after: contentDigest('outside\n'),
                beforeText: '',
                afterText: 'outside\n',
                at: new Date(yield* Clock.currentTimeMillis),
              },
            ],
            lineWrites.replace({ root: target.root, path: 'ignored.txt', before: null, after: 'outside\n' }, Effect.succeed(true)),
          ),
        ).toEqual({ _tag: 'written', kept: true });
        const main = yield* paths.placeAcross(target.root);
        if (main === null) return yield* Effect.die('the main checkout is absent');
        yield* served.judges.moved(RootId.make(main.checkout), ['ignored.txt']);
        expect(yield* select()).toEqual({ projectId: target.id, checkout: side, branch: null });
      }).pipe(Effect.provide(BunFileSystem.layer), Effect.provide(Path.layer)),
    ),
  );
});
