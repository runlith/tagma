import { expect, test } from 'vitest';
import { terminalOpens } from './opens.js';

test('a placed pty or a held program opens as a terminal, a tool call never does, and a launched harness always does', () => {
  expect(terminalOpens({ transport: 'pty', lifetime: 'held', rootId: 'root-1' })).toBe(true);
  expect(terminalOpens({ transport: 'pipes', lifetime: 'held', rootId: 'root-1' })).toBe(true);
  expect(terminalOpens({ transport: 'pipes', lifetime: 'call', rootId: 'root-1' })).toBe(false);
  expect(terminalOpens({ transport: 'pipes', lifetime: 'held' })).toBe(false);
  expect(terminalOpens({ transport: 'pipes', lifetime: 'held', launchedFor: 'thread-1' })).toBe(true);
});
