import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { MINE, THEIRS } from '../checkoutFixture.js';
import { refusalOf } from '../graphFixture.js';
import { fp, programFixture, SEEDED, withProgram, type ProgramFixture } from '../programFixture.js';

const DUP = 'FORBIDDEN dup';
const standingDuplicate = Effect.fnUntraced(function* (gate: ProgramFixture, text: string) {
  yield* gate.put('src/dup.ts', text);
  yield* gate.committed('a counted violation that stands');
  yield* gate.enforcedAt('gate', { [SEEDED]: gate.owner(), [fp(`src/dup.ts × ${DUP}`)]: gate.owner() });
});

layer(programFixture(), { excludeTestServices: true, testTimeout: 60_000, timeout: 60_000 })('counted program judgement', (it) => {
  it.effect('an excess occurrence added beside a peer edit is judged in the session’s selected tree and in explicit whole', () =>
    withProgram((gate) =>
      Effect.gen(function* () {
        yield* standingDuplicate(gate, `export const x = 1; // ${DUP}\nexport const w = 1;\n`);
        yield* gate.wroteAs(THEIRS, 'src/dup.ts', `export const x = 2; // ${DUP}\nexport const w = 2;\n`);
        yield* gate.wroteAs(MINE, 'src/dup.ts', `// ${DUP}\nexport const x = 2; // ${DUP}\nexport const w = 3;\n`);
        expect((yield* refusalOf(gate.landing())).code).toBe('rule-violated');
        expect((yield* refusalOf(gate.landing(undefined, true))).code).toBe('rule-violated');
        expect((yield* gate.checkedChange(true))?.refuses).toBe(true);
      }),
    ),
  );
  it.effect('a peer insertion above an old occurrence the session only edits is the peer’s excess when the file is carried whole', () =>
    withProgram((gate) =>
      Effect.gen(function* () {
        yield* standingDuplicate(gate, `export const x = 1; // ${DUP}\nexport const y = 1;\n`);
        yield* gate.wroteAs(THEIRS, 'src/dup.ts', `export const p = 1; // ${DUP}\nexport const x = 1; // ${DUP}\nexport const y = 2;\n`);
        yield* gate.wroteAs(MINE, 'src/dup.ts', `export const p = 1; // ${DUP}\nexport const x = 2; // ${DUP}\nexport const y = 3;\n`);
        const checked = yield* gate.checkedChange(true);
        expect(checked?.refuses).toBe(false);
        expect(checked?.violations.map(({ line, holders }) => ({ line, holders }))).toEqual([{ line: 1, holders: [THEIRS] }]);
        const receipt = yield* gate.landing(undefined, true);
        expect(
          receipt.status === 'landed' ? receipt.carriedViolations?.map(({ file, line, holders }) => ({ file, line, holders })) : receipt,
        ).toEqual([{ file: 'src/dup.ts', line: 1, holders: [THEIRS] }]);
      }),
    ),
  );
});
