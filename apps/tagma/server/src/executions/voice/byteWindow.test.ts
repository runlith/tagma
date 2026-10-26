import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { saidLines } from '../../platform/contract/service/presentation.js';
import { OperationId } from '../../platform/contract/wire/ids.js';
import { windowVoice } from './byteWindow.js';

const ref = { installation: InstallationId.make('i'), execution: ExecutionId.make('exec-52'), incarnation: 9 };

const at = {
  caller: { actor: { kind: 'operator' as const }, files: null },
  operation: OperationId.make('read_command_bytes'),
  budget: { bytes: 50_000, lines: 2_000 },
};

it.effect('a byte window reads as text after its range and the offset that continues it', () =>
  Effect.gen(function* () {
    const text = yield* saidLines(windowVoice)(
      {
        status: 'ok',
        range: {
          cursor: { ref, stream: 'output', offset: ByteOffset.make('31337') },
          next: ByteOffset.make('31346'),
          retainedFrom: ByteOffset.make('0'),
          durableThrough: ByteOffset.make('31346'),
          gap: false,
        },
        bytes: Buffer.from('\u001b[32mok\u001b[0m\n').toString('base64'),
      },
      { execution: 'exec-52', incarnation: 9, stream: 'output', offset: ByteOffset.make('31337') },
      at,
    );
    if (typeof text !== 'string') return yield* Effect.die('the window was not voiced');
    const lines = text.split('\n');
    const window = lines.indexOf('␛[32mok␛[0m');
    expect(window).toBeGreaterThan(-1);
    for (const handle of ['exec-52:9', '31337', '31346']) {
      const handleAt = lines.findIndex((line) => line.includes(handle));
      expect(handleAt).toBeGreaterThan(-1);
      expect(handleAt).toBeLessThan(window);
    }
  }),
);
