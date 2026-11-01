import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Context, Effect } from 'effect';
import { Access } from '../platform/contract/service/access.js';
import { admitPorts, admitRights } from './ports.js';

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

it.effect('an assembly naming a right needs an access filler, and one naming none needs nothing', () =>
  Effect.gen(function* () {
    const rights = [{ key: 'warmth', by: 'greet_warmly' }];
    const refused = yield* Effect.flip(admitRights(rights, Context.empty()));
    expect(refused.ports).toEqual(['Access (asked by greet_warmly for "warmth")']);
    yield* admitRights([], Context.empty());
    yield* admitRights(rights, Context.make(Access, Access.of({ right: () => Effect.die('unread') })));
  }),
);
