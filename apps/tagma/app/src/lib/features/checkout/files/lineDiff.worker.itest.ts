import { expect, test } from 'vitest';
import { Differ, engineOver } from './Differ.js';

test('the worker returns line edits for concurrent documents to their own askers', async () => {
  const worker = new Worker(`${process.cwd()}/src/lib/features/checkout/files/lineDiff.worker.ts`, { type: 'module' });
  const differ = new Differ(engineOver(() => worker));
  try {
    const first = differ.edits('one\ntwo\nthree', 'one\nchanged\nthree', 'first');
    const second = differ.edits('before', 'after', 'second');

    expect(await first).toEqual([{ from: 1, to: 2, lines: ['changed'] }]);
    expect(await second).toEqual([{ from: 0, to: 1, lines: ['after'] }]);
  } finally {
    worker.terminate();
  }
});
