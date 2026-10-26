import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { makeInterpretation } from './Interpretation';
import { type Presentation, makePresentation } from './Presentation';
import { runtimeProfile } from './runtimeFixture';

const ref = Schema.decodeUnknownSync(ExecutionRef)({ installation: 'installation-1', execution: 'execution-1', incarnation: 0 });

const COLORS = {
  palette: Array.from({ length: 256 }, (_, index) => index * 0x010101),
  foreground: 0xe5e5e5,
  background: 0x000000,
  cursor: 0xe5e5e5,
};

const profile = runtimeProfile({ rows: 4, columns: 30, scrollbackRows: 2, transports: ['pty'] });

it.effect('the text read gives a cell the cursor moved over a space, and a wide character one column of text', () =>
  Effect.gen(function* () {
    const interpretation = yield* makeInterpretation({
      mode: 'open',
      ref,
      geometry: { rows: 4, columns: 30 },
      limits: profile.execution,
      colors: COLORS,
      reply: () => Effect.succeed({ delivered: true, ending: false, detail: '' }),
    });
    const presentation = yield* makePresentation({ interpretation, limits: profile.execution, ref });
    yield* interpretation.feed(new TextEncoder().encode('Welcome\u001b[Cto\u001b[2CClaude  \r\nA漢B\u001b[4Gx'));
    const read = yield* presentation.read({});
    if (read._tag !== 'ScreenTextFrame') return yield* Effect.die(new Error(`no text frame: ${read._tag}`));
    expect(read.rows.slice(0, 2).map((row) => row.text)).toEqual(['Welcome to  Claude', 'A漢x']);
  }),
);

it.effect('a row the next row continues keeps its trailing spaces, which are text and not padding', () =>
  Effect.gen(function* () {
    const interpretation = yield* makeInterpretation({
      mode: 'open',
      ref,
      geometry: { rows: 4, columns: 30 },
      limits: profile.execution,
      colors: COLORS,
      reply: () => Effect.succeed({ delivered: true, ending: false, detail: '' }),
    });
    const presentation = yield* makePresentation({ interpretation, limits: profile.execution, ref });
    const full = `${'x'.repeat(25)} end `;
    yield* interpretation.feed(new TextEncoder().encode(`${full}next  `));
    const read = yield* presentation.read({});
    if (read._tag !== 'ScreenTextFrame') return yield* Effect.die(new Error(`no text frame: ${read._tag}`));
    expect(read.rows.slice(0, 2).map((row) => [row.text, row.wrapped])).toEqual([
      [full, false],
      ['next', true],
    ]);
  }),
);
