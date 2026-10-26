import { layer } from '@runlith/effect-test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { Effect } from 'effect';
import { UNCHECKED } from '../../../enforcement/contract/wire/checks.js';
import type { ActChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { FILE, MINE, makeCheckout, CheckoutFixture, checkoutFixture, withCheckout } from '../checkoutFixture.js';
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect('a landing whose branch moves under each judgement by paths it does not touch lands over the moved branch', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 5; // mine']);
        const judged: string[] = [];
        const peers: string[] = [];
        const peerLands = Effect.fnUntraced(function* (n: number) {
          writeFileSync(join(world.root, 'src', `peer-${n}.ts`), `export const peer = ${n};\n`);
          yield* world.run(['add', '--', `src/peer-${n}.ts`]);
          yield* world.run(['-c', 'user.name=p', '-c', 'user.email=p@p', 'commit', '-q', '-m', `peer ${n}`, '--', `src/peer-${n}.ts`]);
          peers.push(yield* world.run(['rev-parse', 'HEAD']));
        });
        const checks: ActChecks = {
          before: Effect.fnUntraced(function* (subject) {
            judged.push(subject.kind === 'tree' ? subject.base : '');
            if (judged.length <= 3) yield* Effect.orDie(peerLands(judged.length));
            return UNCHECKED;
          }),
          after: () => Effect.void,
        };
        const answer = yield* world.submit(MINE, { checks });
        expect(answer.status).toBe('landed');
        expect(yield* world.run(['rev-parse', 'HEAD^'])).toBe(peers.at(-1) as string);
        expect(judged.at(-1)).toBe(peers.at(-1) as string);
        expect(yield* world.committed()).toEqual([...FILE.slice(0, 4), 'const five = 5; // mine']);
        expect((yield* world.run(['ls-tree', '--name-only', 'HEAD', 'src/'])).split('\n')).toEqual([
          'src/a.ts',
          'src/peer-1.ts',
          'src/peer-2.ts',
          'src/peer-3.ts',
        ]);
      })(),
    ),
  );
});
