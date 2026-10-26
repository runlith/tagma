import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Context, Effect } from 'effect';
import { admitPorts } from './ports.js';

class First extends Context.Service<First, { readonly value: number }>()('test/First') {}
class Second extends Context.Service<Second, { readonly value: number }>()('test/Second') {}

const ports = [
  ['First', First],
  ['Second', Second],
] as const;

it.effect('an assembly missing a mandatory port is refused naming the port', () =>
  Effect.gen(function* () {
    const partial = Context.make(First, { value: 1 });
    const refused = yield* Effect.flip(admitPorts(partial, ports));
    expect(refused._tag).toBe('AssemblyInvalid');
    expect(refused.ports).toEqual(['Second']);
  }),
);
