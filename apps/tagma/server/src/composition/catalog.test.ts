import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Effect } from 'effect';
import { OPERATION_IDS, OPERATIONS } from './catalog.js';
import { collectedOperations, ownerOf } from './testing/composed.js';
import type { Operation } from '../platform/contract/wire/operation.js';

it.effect('the browser catalog carries the same declarations as the serving modules', () =>
  Effect.gen(function* () {
    const { declarations } = yield* collectedOperations;
    expect<readonly string[]>([...OPERATION_IDS].sort()).toEqual(declarations.map((declaration) => String(declaration.id)).sort());
    for (const declaration of declarations) {
      const projected: Operation = OPERATIONS[declaration.id as keyof typeof OPERATIONS];
      expect(projected.params).toBe(declaration.input);
      expect(projected.doors).toEqual(declaration.doors);
      expect(projected.callers).toBe(declaration.callers);
    }
  }),
);

it('the owner of a name is the module declaring it: an operation’s module, or the module of a built-in tool’s code', () => {
  expect(ownerOf('create_block')).toBe('graph');
  expect(ownerOf('bash')).toBe('@runlith/agent-tools');
  expect(ownerOf('read')).toBe('@runlith/agent-tools');
  expect(ownerOf('no_such_thing')).toBeNull();
});
