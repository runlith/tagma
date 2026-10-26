import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, Layer } from 'effect';
import { sql } from 'drizzle-orm';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { MachineStore } from '../contract/service/store.js';
import { storePlace } from '../testing/connection.js';
import { shippedChain } from './chain.js';
import { storeLayer } from './open.js';

layer(BunFileSystem.layer, { excludeTestServices: true })('shipped chain', (it) => {
  it.effect('the shipped chain opens from an empty store and reopens with its whole ledger', () =>
    Effect.gen(function* () {
      const path = yield* storePlace('tagma-chain-current-');
      const expected = shippedChain(fixtureMigrations);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const state = yield* Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(storeLayer(MachineStore, path, fixtureMigrations, { readers: 0 }));
            const store = Context.get(context, MachineStore);
            return { schema: store.schema, enabled: yield* store.db.all(sql`pragma foreign_keys`) };
          }),
        );
        expect(state).toEqual({ schema: expected, enabled: [{ foreign_keys: 1 }] });
      }
    }),
  );
});
