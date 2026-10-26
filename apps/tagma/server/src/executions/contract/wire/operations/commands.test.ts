import { expect, test } from 'bun:test';
import { COMMAND_OPERATIONS } from './commandCatalog.js';

test('command reads declare a command reference and their maximum wait in milliseconds', () => {
  const address = { execution: 'exec-1', incarnation: 3 };
  const reference = { kind: 'command', ...address, standing: false };
  expect(COMMAND_OPERATIONS.read_output.called({ ...address, wait: 60 })).toMatchObject({
    reference,
    awaitsMs: 60_000,
  });
  expect(COMMAND_OPERATIONS.read_output.called(address).awaitsMs).toBe(0);
  expect(COMMAND_OPERATIONS.wait_command.called({ ...address, waitMs: 90_000 })).toMatchObject({
    reference,
    awaitsMs: 90_000,
  });
  expect(Reflect.apply(COMMAND_OPERATIONS.read_output.called, undefined, [{ execution: address.execution }]).title).toBeUndefined();
  expect(Reflect.apply(COMMAND_OPERATIONS.wait_command.called, undefined, [address]).title).toBeUndefined();
});
