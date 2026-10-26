import { expect } from 'bun:test';
import { posix } from 'node:path';
import { Context, Effect } from 'effect';
import { it } from '@runlith/effect-test';
import { toolClaims } from '@runlith/agent/tool';
import { unthreadedCaller } from '../callers';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import type { TagTable } from '../../../graph/contract/wire/tags/table.js';
import { fixtureNativeCatalog } from '../nativeCatalog.js';

it.effect('a thread whose file scope is its scratch orders strip_comments by the checkout path it writes', () =>
  Effect.gen(function* () {
    const tools = yield* fixtureNativeCatalog(
      {
        place: { root: '/checkout', origin: null },
        caller: {
          actor: { kind: 'operator' },
          files: { path: '/scratch', resolve: (candidate) => posix.resolve('/scratch', candidate) },
        },
        project: { id: 1, name: 'demo' },
        vocabulary: () => ({}) as TagTable,
        identity: testSessionIdentity,
        world: 'checkout',
        owners: Context.empty() as never,
      },
      ['strip_comments'],
    );
    const claims = yield* toolClaims(tools.strip_comments!, { path: 'src/a.ts' }, { toolCallId: 'sweep', caller: unthreadedCaller });
    expect(claims).toEqual([{ on: { kind: 'file', path: '/checkout/src/a.ts' }, access: 'write' }]);
  }),
);
