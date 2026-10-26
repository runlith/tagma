import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Context, Effect, Exit, FileSystem, Queue, Schema, Scope, Tracer } from 'effect';
import { Measurement } from '../../../enforcement/contract/wire/enforcement.js';
import { driverOver } from '../../../enforcement/testing/wiring.js';
import { fixedCoverage } from '../../../workspace/testing/doubles.js';
import { BOUND, fp, programFixture, SEEDED, withProgram } from '../programFixture.js';

layer(programFixture(), { excludeTestServices: true })('program remeasurement passes', (it) => {
  it.effect('a program remeasurement after enforcement and after a restart keeps the last actual pass', () =>
    withProgram((gate) =>
      Effect.gen(function* () {
        const demo = gate.current();
        const keep = fp('src/keep.ts × FORBIDDEN keep');
        yield* gate.put('src/keep.ts', 'export const keep = 1; // FORBIDDEN keep\n');
        yield* gate.committed('another standing violation');
        yield* gate.enforce({
          strictness: 'watch',
          inspection: BOUND,
          on: [{ op: 'submit_work', phase: 'after' }],
          owners: { [SEEDED]: gate.owner(), [keep]: gate.owner() },
        });
        const files = yield* FileSystem.FileSystem;
        const row = yield* demo.graph.blocks.blockById(yield* demo.graph.blockNames.idOfName(gate.rule()));
        const reading = files
          .readFileString(join(demo.demoRoot, '.git/tagma/measured', `${row.uuid}.json`))
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Measurement))));
        const enforced = yield* reading;
        expect(enforced.ms).toBeGreaterThan(0);
        const coverage = fixedCoverage(demo.projectId, [{ checkout: 'demo', root: demo.demoRoot }]);
        const memory = join(demo.fixture.root, 'remeasured.json');
        const boot = Effect.fnUntraced(function* () {
          const settled = yield* Queue.unbounded<Exit.Exit<unknown, unknown>>();
          const pass = Queue.take(settled).pipe(
            Effect.flatMap((exit) => (Exit.isFailure(exit) ? Effect.failCause(exit.cause) : Effect.void)),
          );
          const tracer = Tracer.make({
            span: (options) => {
              const span = new Tracer.NativeSpan(options);
              const end = span.end.bind(span);
              span.end = (at, exit) => {
                end(at, exit);
                if (span.name === 'enforcement.remeasureRule') Queue.offerUnsafe(settled, exit);
              };
              return span;
            },
          });
          const scope = yield* Scope.fork(yield* Effect.scope);
          const driver = yield* Scope.provide(
            driverOver({
              graphOf: () => Effect.succeed(gate.context().pipe(Context.add(Tracer.Tracer, tracer))),
              memory,
              delayMs: 0,
              coverage,
            }),
            scope,
          );
          return { driver, pass, close: Scope.close(scope, Exit.void) };
        });
        const applying = yield* boot();
        yield* applying.driver.enforced({ projectId: demo.projectId, root: demo.demoRoot, rule: gate.rule() });
        yield* applying.pass;
        expect(yield* reading).toEqual(enforced);
        yield* applying.close;
        const starting = yield* boot();
        yield* starting.pass;
        expect(yield* reading).toEqual(enforced);
        yield* starting.close;
      }),
    ),
  );
});
