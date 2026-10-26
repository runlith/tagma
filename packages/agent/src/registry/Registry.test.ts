import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { Registry, RegistryCollision } from './Registry';
describe('Registry', () => {
  it.effect(
    'a duplicate registration names both owners and leaves the first standing',
    Effect.fnUntraced(function* () {
      const registry = new Registry<string>('probe');
      yield* registry.register('a', 'first', 'one');
      const refused = new RegistryCollision({ registry: 'probe', id: 'a', holder: 'first', claimant: 'second' });
      expect(yield* Effect.flip(registry.register('a', 'second', 'two'))).toMatchObject(refused);
      expect(registry.find('a')).toBe('one');
      const seed = Effect.try(
        () =>
          new Registry<string>('probe', [
            { id: 'a', owner: 'x', value: '1' },
            { id: 'a', owner: 'y', value: '2' },
          ]),
      );
      const collision = new RegistryCollision({ registry: 'probe', id: 'a', holder: 'x', claimant: 'y' });
      expect((yield* Effect.flip(seed)).cause).toMatchObject(collision);
    }),
  );
  it.effect(
    'withdrawal retires a read registration once, and its stale disposer cannot withdraw a successor',
    Effect.fnUntraced(function* () {
      const registry = new Registry<string>('probe');
      const dispose = yield* registry.register('a', 'first', 'one');
      const [read] = registry.registrations();
      expect(read?.standing()).toBe(true);
      const registered = registry.revision;
      dispose();
      dispose();
      expect(registry.revision).toBe(registered + 1);
      expect(registry.find('a')).toBeUndefined();
      yield* registry.register('a', 'second', 'two');
      dispose();
      expect(registry.find('a')).toBe('two');
      expect(read?.standing()).toBe(false);
    }),
  );
});
