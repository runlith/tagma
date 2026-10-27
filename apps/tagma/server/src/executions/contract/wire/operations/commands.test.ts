import { expect, test } from 'bun:test';
import { COMMAND_OPERATIONS } from './commandCatalog.js';

test('a read of command output declares the command it reads and no wait', () => {
  const address = { execution: 'exec-1', incarnation: 3 };
  expect(COMMAND_OPERATIONS.read_output.called(address)).toMatchObject({
    reference: { kind: 'command', ...address, standing: false },
    awaitsMs: 0,
  });
  expect(Reflect.apply(COMMAND_OPERATIONS.read_output.called, undefined, [{ execution: address.execution }]).title).toBeUndefined();
});
