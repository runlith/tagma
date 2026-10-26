import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Layer } from 'effect';
import { demoGraphLayer, gitEffect, withDemo } from '../graphFixture.js';
import { enforcementApplied, enforcementBaseOf, ruleRemeasured, withLanes, workerLanes } from '../../../enforcement/testing/wiring.js';

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('delta remeasurement', (it) => {
  it.effect('fixing one file retires only its debt while retaining uninspected debt and escapes', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const workers = yield* Effect.acquireRelease(
          Effect.sync(() => workerLanes('delta-inspection')),
          (workers) => Effect.sync(() => workers.close()),
        );
        const put = (path: string, text: string) => files.writeFileString(join(demo.demoRoot, 'src', path), text);
        const commit = Effect.fnUntraced(function* () {
          yield* gitEffect(demo.demoRoot, ['add', '.']);
          yield* gitEffect(demo.demoRoot, ['commit', '-qm', 'step']);
        });
        yield* files.makeDirectory(join(demo.demoRoot, 'src'));
        yield* put('keep.ts', 'export const a = 1;\nexport const b = 2;\n');
        yield* put('fix.ts keep.ts', 'export const a = 1;\nexport const b = 2;\n');
        yield* put('fix.ts', 'export const a = 1;\nexport const b = 2;\n');
        yield* gitEffect(demo.demoRoot, ['init', '-q', '-b', 'main']);
        yield* gitEffect(demo.demoRoot, ['config', 'user.email', 'tagma@test']);
        yield* gitEffect(demo.demoRoot, ['config', 'user.name', 'tagma']);
        yield* commit();
        const rule = yield* demo.graph.blocks.create({ projectId: demo.projectId, tags: ['rule'], title: 'Small files' });
        const owner = yield* demo.graph.blocks.create({ projectId: demo.projectId, tags: ['task'], title: 'Split files' });
        const ownerName = yield* demo.nameOf(owner.id);
        const context = withLanes(demo.context, workers);
        demo.described.set('small', {
          builtin: 'size',
          params: {
            base: 'src',
            files: { extensions: ['.ts'], exclude: [] },
            thresholds: [{ glob: '**', metric: 'non-import', lines: 1 }],
          },
        });
        yield* enforcementApplied(rule, {
          strictness: 'watch',
          inspection: 'small',
          owners: { 'keep.ts': ownerName, 'fix.ts': ownerName, 'fix.ts keep.ts': ownerName },
          on: [{ op: 'submit_work', phase: 'before' }],
          caller: null,
          subjectOf: () => 'tree',
          base: yield* enforcementBaseOf(rule),
        }).pipe(Effect.provide(context));
        const ruleName = yield* demo.nameOf(rule.id);
        yield* put('escape.ts', 'export const a = 1;\nexport const b = 2;\n');
        yield* commit();
        const escaped = yield* ruleRemeasured(demo.projectId, ruleName).pipe(Effect.provide(context));
        expect(escaped._tag === 'Measured' && escaped.escaped.map((entry) => entry.path)).toEqual(['src/escape.ts']);
        yield* put('fix.ts', 'export const a = 1;\n');
        yield* commit();
        const measured = yield* ruleRemeasured(demo.projectId, ruleName).pipe(Effect.provide(context));
        expect(measured._tag === 'Measured' && measured.retired.map((entry) => entry.fingerprint)).toEqual(['fix.ts']);
        expect((yield* demo.graph.blocks.blockById(rule.id)).fields.enforcement).toMatchObject({
          debt: [
            { fingerprint: 'fix.ts keep.ts', owner: ownerName, value: 2 },
            { fingerprint: 'keep.ts', owner: ownerName, value: 2 },
          ],
          escaped: [{ fingerprint: 'escape.ts', path: 'src/escape.ts' }],
        });
      }),
    ),
  );
});
