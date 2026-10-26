import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { saidLines } from '../../platform/contract/service/presentation.js';
import { OperationId } from '../../platform/contract/wire/ids.js';
import { screenVoice } from './screen.js';

const ref = { installation: InstallationId.make('i'), execution: ExecutionId.make('exec-71'), incarnation: 3 };

const at = {
  caller: { actor: { kind: 'operator' as const }, files: null },
  operation: OperationId.make('read_terminal_screen'),
  budget: { bytes: 50_000, lines: 2_000 },
};

it.effect('the screen reads as one block after its handles: wrapped rows glued, no empty tail', () =>
  Effect.gen(function* () {
    const text = yield* saidLines(screenVoice)(
      {
        status: 'ok',
        screen: {
          _tag: 'ScreenTextFrame',
          provenance: { ref, revision: 4242, parsedThrough: ByteOffset.make('918273') },
          buffer: 'normal',
          geometry: { rows: 6, columns: 8, firstLine: 0, viewportLine: 0 },
          rows: [
            { line: 0, wrapped: false, text: 'abc def ' },
            { line: 1, wrapped: true, text: 'ghi' },
            { line: 2, wrapped: false, text: 'tail    ' },
            { line: 3, wrapped: true, text: '' },
            { line: 4, wrapped: false, text: '' },
            { line: 5, wrapped: false, text: '' },
          ],
          cursor: { line: 2, column: 0 },
          input: { _tag: 'Unavailable', revision: 6061, reason: 'not read' },
          title: '',
        },
      },
      { execution: 'exec-71', incarnation: 3 },
      at,
    );
    if (typeof text !== 'string') return yield* Effect.die('the screen was not voiced');
    const lines = text.split('\n');
    const screenAt = lines.indexOf('abc def ghi');
    expect(lines.slice(screenAt)).toEqual(['abc def ghi', 'tail']);
    for (const handle of ['exec-71:3', '4242', '918273', '6061']) {
      const handleAt = lines.findIndex((line) => line.includes(handle));
      expect(handleAt).toBeGreaterThan(-1);
      expect(handleAt).toBeLessThan(screenAt);
    }
  }),
);
