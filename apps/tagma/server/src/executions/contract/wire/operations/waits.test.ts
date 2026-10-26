import { expect, test } from 'bun:test';
import { TERMINAL_OPERATIONS } from './terminalCatalog.js';

test('a wait on a terminal declares the execution it watches and its budget in milliseconds', () => {
  const display = TERMINAL_OPERATIONS.wait_terminal.called({ execution: 'exec-1', incarnation: 3, waitMs: 90_000 });
  expect(display).toMatchObject({ awaitsMs: 90_000, reference: { kind: 'terminal', execution: 'exec-1', incarnation: 3 } });
});

test('a terminal wait whose arguments are still streaming declares nothing to watch', () => {
  expect(Reflect.apply(TERMINAL_OPERATIONS.wait_terminal.called, undefined, [{ execution: 'exec-1' }]).reference).toBeUndefined();
});
