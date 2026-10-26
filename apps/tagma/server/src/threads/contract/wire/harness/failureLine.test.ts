import { describe, expect, test } from 'bun:test';
import { TerminalRefused } from '../../../../executions/contract/wire/refusals.js';
import { refusalLine } from './failureLine.js';

describe('a refused launch reads as one sentence', () => {
  test('a host-state refusal carries its cause, the runnable act, and the marker', () => {
    const line = refusalLine(new TerminalRefused({ reason: 'host-state', message: 'the host could not be read: Expected 10 at ["v"]' }));
    expect(line.hostState).toBe(true);
    expect(line.text).toContain('Expected 10 at ["v"]');
    expect(() => JSON.parse(line.text) as unknown).toThrow();
  });

  test('any other refusal reads human but offers no replace act', () => {
    const line = refusalLine(
      new TerminalRefused({ reason: 'no-command', message: 'The host holds no bounded command under this reference.' }),
    );
    expect(line.hostState).toBe(false);
    expect(line.text).toContain('no bounded command');
  });
});
