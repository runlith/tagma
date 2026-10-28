import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { NamespaceId } from '@runlith/files/namespace';
import { commitOf } from '@runlith/git/repository';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Deferred, Effect, FileSystem, Layer, Path, Queue, Schema } from 'effect';
import { lawEnforcementSchema } from '../../../graph/contract/wire/enforcement.js';
import { demoGraphLayer, gitEffect, withDemo } from '../graphFixture.js';
import { coveredWorkspace, gitCheckoutRows } from '../../../workspace/testing/doubles.js';
import {
  driverOver,
  enforcementApplied,
  enforcementBaseOf,
  journalOver,
  withLanes,
  workerLanes,
} from '../../../enforcement/testing/wiring.js';

layer(Layer.mergeAll(demoGraphLayer(), BunFileSystem.layer, Path.layer), { excludeTestServices: true })('HEAD remeasurement', (it) => {
  it.effect('a hookless commit records an unheld escape and moving its branch back retires it without a landing', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const root = demo.demoRoot;
        yield* files.makeDirectory(join(root, 'src'));
        yield* files.writeFileString(join(root, 'src/model.ts'), 'export const a = 1;\n');
        yield* gitEffect(root, ['init', '-q', '-b', 'main']);
        yield* gitEffect(root, ['config', 'user.email', 'tagma@test']);
        yield* gitEffect(root, ['config', 'user.name', 'tagma']);
        yield* gitEffect(root, ['add', '.']);
        yield* gitEffect(root, ['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'seed']);
        const workers = yield* Effect.acquireRelease(
          Effect.sync(() => workerLanes('head-inspection')),
          (workers) => Effect.sync(() => workers.close()),
        );
        const context = withLanes(demo.context, workers);
        const rule = yield* demo.graph.blocks.create({
          projectId: demo.projectId,
          parentId: demo.root,
          tags: ['rule'],
          title: 'Small files',
        });
        demo.described.set('small', {
          builtin: 'size',
          params: {
            base: 'src',
            files: { extensions: ['.ts'], exclude: [] },
            thresholds: [{ glob: '**', metric: 'non-import', lines: 1 }],
          },
        });
        const enforced = yield* enforcementApplied(rule, {
          strictness: 'gate',
          inspection: 'small',
          on: [{ op: 'submit_work', phase: 'before' }],
          caller: null,
          subjectOf: () => 'tree',
          base: yield* enforcementBaseOf(rule),
        }).pipe(Effect.provide(context));
        const workspace = yield* coveredWorkspace({
          namespaceId: NamespaceId.make('head-remeasure'),
          projects: demo.graph.projects,
          git: demo.graph.git,
        }).pipe(Effect.provide(demo.context));
        const checkouts = yield* gitCheckoutRows(demo.graph.git, workspace.roots, files, yield* Effect.scope).pipe(
          Effect.provide(demo.context),
        );
        const changed = yield* Queue.unbounded<void>();
        yield* Effect.acquireRelease(
          demo.graph.feed.subscribe(demo.projectId, (frame) => {
            if (frame.type === 'change' && frame.events.some((event) => event.op === 'remeasure')) Queue.offerUnsafe(changed, undefined);
          }),
          (unsubscribe) => Effect.sync(unsubscribe),
        );
        const settled = yield* Deferred.make<void>();
        const journal = journalOver(demo.graph.store.db, demo.graph.units);
        const driver = yield* driverOver({
          graphOf: () => Effect.succeed(context),
          delayMs: 0,
          checkouts,
          coverage: workspace.coverage,
          journal: { ...journal, remove: (key) => journal.remove(key).pipe(Effect.tap(() => Deferred.succeed(settled, undefined))) },
        });
        yield* driver.landed('submit_work', {
          kind: 'tree',
          projectId: demo.projectId,
          root,
          commit: enforced.head!,
          paths: ['src/model.ts'],
        });
        yield* Deferred.await(settled);
        yield* files.writeFileString(join(root, 'src/model.ts'), 'export const a = 1;\nexport const b = 2;\n');
        yield* gitEffect(root, ['add', '.']);
        yield* gitEffect(root, ['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'escape']);
        const commit = yield* commitOf(demo.graph.git, root, 'HEAD');
        yield* Queue.take(changed);
        const recorded = yield* Schema.decodeUnknownEffect(lawEnforcementSchema)(
          (yield* demo.graph.blocks.blockById(rule.id)).fields.enforcement,
        );
        expect(recorded.escaped).toMatchObject([{ fingerprint: 'model.ts', path: 'src/model.ts', commit }]);
        expect(recorded.escaped[0]?.holder).toBeUndefined();
        yield* gitEffect(root, ['update-ref', 'refs/heads/main', enforced.head!]);
        yield* Queue.take(changed);
        expect((yield* demo.graph.blocks.blockById(rule.id)).fields.enforcement).toMatchObject({ escaped: [] });
      }),
    ),
  );
});
