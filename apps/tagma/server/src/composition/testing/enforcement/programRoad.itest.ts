import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { programFixture, withProgram } from '../programFixture.js';

layer(programFixture({ timeMs: 3_000 }), { excludeTestServices: true })('program failures', (it) => {
  it.effect('a program that exits non-zero, prints garbage or is stopped at its time lands unjudged at gate and watch', () =>
    withProgram((gate) =>
      Effect.gen(function* () {
        yield* gate.enforcedAt('gate');
        yield* gate.wrote('src/x.ts', '// CRASH\n');
        const crashed = yield* gate.landing();
        expect(crashed).toMatchObject({
          status: 'landed',
          unjudged: [{ rule: gate.rule(), cause: 'program', failed: expect.stringContaining('crashed reading the change') }],
        });
        yield* gate.wrote('src/x.ts', '// GARBAGE\n');
        expect(yield* gate.landing()).toMatchObject({ status: 'landed', unjudged: [{ rule: gate.rule(), failed: expect.any(String) }] });
        yield* gate.wrote('src/x.ts', '// SLEEP\n');
        expect(yield* gate.landing()).toMatchObject({ status: 'landed', unjudged: [{ rule: gate.rule(), failed: expect.any(String) }] });
        yield* gate.wrote('src/x.ts', 'export const ready = 1;\n');
        expect(yield* gate.landing()).toMatchObject({ status: 'landed' });
        yield* gate.enforcedAt('watch');
        yield* gate.wrote('src/x.ts', '// CRASH\n');
        const receipt = yield* gate.landing();
        expect(receipt.status === 'landed' ? receipt.unjudged : receipt).toEqual([
          { rule: gate.rule(), cause: 'program', failed: expect.stringContaining('crashed reading the change'), ways: expect.any(Array) },
        ]);
      }),
    ),
  );
});
