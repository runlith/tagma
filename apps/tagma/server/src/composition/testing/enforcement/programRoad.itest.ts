import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { refusalOf } from '../graphFixture.js';
import { programFixture, withProgram } from '../programFixture.js';

layer(programFixture({ timeMs: 3_000 }), { excludeTestServices: true })('program failures', (it) => {
  it.effect(
    'a program that exits non-zero, prints garbage or is stopped at its time refuses inspection-failed at gate, and lands named with its failure at watch',
    () =>
      withProgram((gate) =>
        Effect.gen(function* () {
          yield* gate.enforcedAt('gate');
          yield* gate.wrote('src/x.ts', '// CRASH\n');
          const crashed = yield* refusalOf(gate.landing());
          expect(crashed.code).toBe('inspection-failed');
          expect(crashed.reason).toContain('crashed reading the change');
          yield* gate.wrote('src/x.ts', '// GARBAGE\n');
          expect((yield* refusalOf(gate.landing())).code).toBe('inspection-failed');
          yield* gate.wrote('src/x.ts', '// SLEEP\n');
          expect((yield* refusalOf(gate.landing())).code).toBe('inspection-failed');
          yield* gate.enforcedAt('watch');
          yield* gate.wrote('src/x.ts', '// CRASH\n');
          const receipt = yield* gate.landing();
          expect(receipt.status === 'landed' ? receipt.watched : receipt).toEqual([
            { rule: gate.rule(), cause: expect.any(String), failed: expect.stringContaining('crashed reading the change') },
          ]);
        }),
      ),
  );
});
