import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PACKS, type Assembled } from '@tagma/inspection/builtins';
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Tracer } from 'effect';
import { FactCache } from '../contract/service/factCache.js';
import { InspectionCode } from '../contract/service/inspectionCode.js';
import { Inspections, inspections, inspectionsLayer } from './inspectionLanes.js';

const temp = (prefix: string) => Effect.flatMap(FileSystem.FileSystem, (files) => files.makeTempDirectoryScoped({ prefix }));

const lanes = (options: Parameters<typeof inspections>[0]) =>
  Effect.acquireRelease(
    Effect.sync(() => inspections(options)),
    (opened) => Effect.sync(() => opened.close()),
  );

layer(BunFileSystem.layer, { excludeTestServices: true })('inspection lanes', (it) => {
  it.effect('a server starts its inspection lanes over an empty fact cache, so nothing a former build recorded is read', () =>
    Effect.gen(function* () {
      const home = yield* temp('inspection-lanes-');
      const root = join(home, 'facts');
      mkdirSync(root);
      const recorded = join(root, 'repository.sqlite');
      writeFileSync(recorded, 'recorded by a former build');
      const code = yield* Effect.scoped(
        Effect.map(
          Layer.build(
            inspectionsLayer.pipe(
              Layer.provide(Layer.merge(Layer.succeed(FactCache, { root }), Layer.succeed(InspectionCode, 'installed-code'))),
            ),
          ),
          (context) => Context.get(context, Inspections).code,
        ),
      );
      expect(existsSync(recorded)).toBe(false);
      expect(code).toBe('installed-code');
    }),
  );

  it.effect('a missing or closing inspection worker fails its request and a later request reaches the replacement', () =>
    Effect.gen(function* () {
      const home = yield* temp('inspection-worker-loss-');
      const entry = join(home, 'reach.worker.ts');
      const service = yield* lanes({ reach: pathToFileURL(entry) });
      const ask = () => Effect.result(service.packs({ root: home, commit: 'HEAD' }));
      const missing = yield* ask();
      expect(missing._tag === 'Failure' ? missing.failure : null).toMatchObject({
        _tag: 'InspectionFailed',
        cause: 'worker',
        worker: { _tag: 'WorkerUnavailable' },
      });
      writeFileSync(entry, 'process.exit(0);\n');
      const closed = yield* ask();
      expect(closed._tag === 'Failure' ? closed.failure : null).toMatchObject({
        _tag: 'InspectionFailed',
        cause: 'worker',
        worker: { _tag: 'WorkerUnavailable' },
      });
      const packs = [PACKS[0]!.id];
      writeFileSync(
        entry,
        `self.addEventListener('message', ({ data }) => postMessage({ id: data.id, answered: true, packs: ${JSON.stringify(packs)} }));\n`,
      );
      expect(yield* service.packs({ root: home, commit: 'HEAD' })).toEqual(packs);
    }),
  );

  it.effect('background reach yields to foreground inspection on every lane and resumes after its interruption', () =>
    Effect.gen(function* () {
      const home = yield* temp('inspection-priority-');
      const entry = join(home, 'inspection.worker.ts');
      writeFileSync(
        entry,
        `self.addEventListener('message', ({ data }) => {
    if (data.kind === 'packs') return;
    postMessage({ id: data.id, answered: true, verdict: { violations: [], unjudged: [] }, read: [], ms: 7 });
  });\n`,
      );
      const service = yield* lanes({ reach: pathToFileURL(entry), judging: pathToFileURL(entry) });
      const entered = yield* Deferred.make<void>();
      const tracer = Tracer.make({
        span: (options) => {
          if (options.name === 'inspection.worker') Deferred.doneUnsafe(entered, Effect.void);
          return new Tracer.NativeSpan(options);
        },
      });
      const inspection: Assembled = {
        builtin: 'size',
        params: {
          base: 'src',
          files: { extensions: ['.ts'], exclude: [] },
          thresholds: [{ glob: '**', metric: 'non-import', lines: 100 }],
        },
      };
      const foreground = yield* Effect.forkChild(service.packs({ root: home, commit: 'HEAD' }).pipe(Effect.withTracer(tracer)));
      yield* Deferred.await(entered);
      const queued = yield* Effect.forkChild(service.reach({ root: home, commit: 'HEAD', inspection, places: ['src'] }, 'background'));
      const judged = yield* service.judge({
        lane: 'landing',
        root: home,
        base: 'HEAD',
        built: 'HEAD',
        paths: [],
        places: ['src'],
        inspection,
        debt: [],
      });
      expect(judged.ms).toBe(7);
      expect(queued.pollUnsafe()).toBeUndefined();
      yield* Fiber.interrupt(foreground);
      expect((yield* Fiber.join(queued)).ms).toBe(7);
    }),
  );
});
