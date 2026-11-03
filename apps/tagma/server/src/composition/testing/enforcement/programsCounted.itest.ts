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

layer(programFixture(), { excludeTestServices: true })('counted program judgement', (it) => {
  it.effect('an excess occurrence added beside a peer edit refuses the landing and the change check alike', () =>
    withProgram((gate) =>
      Effect.gen(function* () {
        yield* standingDuplicate(gate, `export const x = 1; // ${DUP}\nexport const w = 1;\n`);
        yield* gate.wroteAs(THEIRS, 'src/dup.ts', `export const x = 2; // ${DUP}\nexport const w = 2;\n`);
        yield* gate.wroteAs(MINE, 'src/dup.ts', `// ${DUP}\nexport const x = 2; // ${DUP}\nexport const w = 3;\n`);
        expect((yield* refusalOf(gate.landing())).code).toBe('rule-violated');
        expect((yield* gate.checkedChange())?.refuses).toBe(true);
      }),
    ),
  );
  it.effect(
    'an old occurrence edited in place is no excess, while a peer’s insertion elsewhere in the file is, and refuses the landing',
    () =>
      withProgram((gate) =>
        Effect.gen(function* () {
          const middle = 'export const a = 1;\nexport const b = 1;\nexport const c = 1;\n';
          yield* standingDuplicate(gate, `export const x = 1; // ${DUP}\n${middle}`);
          yield* gate.wroteAs(THEIRS, 'src/dup.ts', `export const x = 1; // ${DUP}\n${middle}export const p = 1; // ${DUP}\n`);
          yield* gate.wroteAs(MINE, 'src/dup.ts', `export const x = 2; // ${DUP}\n${middle}export const p = 1; // ${DUP}\n`);
          const checked = yield* gate.checkedChange();
          expect(checked?.refuses).toBe(true);
          expect(checked?.violations.map(({ line, holders }) => ({ line, holders }))).toEqual([{ line: 5, holders: [THEIRS] }]);
          expect((yield* refusalOf(gate.landing())).code).toBe('rule-violated');
        }),
      ),
  );
});
