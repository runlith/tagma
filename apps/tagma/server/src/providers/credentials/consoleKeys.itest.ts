import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { afterAll, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { consoleAccountOf, makeConsoleKeyStore } from './consoleKeys.js';
import { CONSOLE_KEYS_FILE, consoleKeyFile } from './consoleKeyFile.js';

const layers = unitsLayer(MachineUnits, MachineStore).pipe(Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations)));

const home = mkdtempSync(join(tmpdir(), 'console-keys-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));
const keys = Effect.map(Effect.all([MachineStore, MachineUnits]), ([store, units]) =>
  makeConsoleKeyStore({ db: store.db, units, file: consoleKeyFile(mkdtempSync(join(home, 'keys-'))) }),
);

layer(layers)('console keys', (it) => {
  it.effect('a pasted console key round-trips under its derived account and removal returns to absence', () =>
    Effect.gen(function* () {
      const store = yield* keys;
      expect(yield* store.has('muse')).toBe(false);
      expect(yield* store.key('muse')).toBeNull();

      const account = yield* store.save('muse', 'LLM-pasted');
      expect(account).toBe(consoleAccountOf('LLM-pasted'));
      expect(yield* store.has('muse')).toBe(true);
      expect(yield* store.key('muse')).toBe('LLM-pasted');
      expect(yield* store.has('absent')).toBe(false);

      yield* store.remove('muse', account);
      expect(yield* store.has('muse')).toBe(false);
      expect(yield* store.key('muse')).toBeNull();
    }),
  );

  it.effect('two keys of one provider stand side by side, and neither is spent without being named', () =>
    Effect.gen(function* () {
      const store = yield* keys;
      const first = yield* store.save('opencode-go', 'oc_sk_first');
      const second = yield* store.save('opencode-go', 'oc_sk_second');

      expect(first).not.toBe(second);
      expect((yield* store.accounts('opencode-go')).map((row) => row.account).toSorted()).toEqual([first, second].toSorted());
      expect(yield* store.key('opencode-go', first)).toBe('oc_sk_first');
      expect(yield* store.key('opencode-go', second)).toBe('oc_sk_second');
      expect(yield* store.key('opencode-go')).toBeNull();

      yield* store.remove('opencode-go', first);
      expect(yield* store.key('opencode-go')).toBe('oc_sk_second');
    }),
  );

  it.effect('a key saved as a rotation replaces the account it names instead of standing beside it', () =>
    Effect.gen(function* () {
      const store = yield* keys;
      const original = yield* store.save('rotation', 'LLM-pasted');
      const rotated = yield* store.save('rotation', 'LLM-rotated', original);

      expect((yield* store.accounts('rotation')).map((row) => row.account)).toEqual([rotated]);
      expect(yield* store.key('rotation')).toBe('LLM-rotated');
    }),
  );

  it.effect('a key standing in the store moves to the key file and leaves the column empty', () =>
    Effect.gen(function* () {
      const { db } = yield* MachineStore;
      const units = yield* MachineUnits;
      const directory = mkdtempSync(join(home, 'move-'));
      const account = consoleAccountOf('LLM-standing');
      yield* db.run(
        sql`insert into console_key (provider, account, key_value, updated_at) values ('legacy', '', 'LLM-standing', 0), ('legacy', ${account}, '', 0)`,
      );
      const store = makeConsoleKeyStore({ db, units, file: consoleKeyFile(directory) });
      yield* store.moveKeys();

      expect(yield* store.key('legacy')).toBe('LLM-standing');
      expect(yield* db.all(sql`select account, key_value from console_key where provider = 'legacy'`)).toEqual([
        { account, key_value: '' },
      ]);
      expect(JSON.parse(readFileSync(join(directory, CONSOLE_KEYS_FILE), 'utf8'))).toEqual({
        version: 1,
        keys: { legacy: { [account]: 'LLM-standing' } },
      });
    }),
  );
});
