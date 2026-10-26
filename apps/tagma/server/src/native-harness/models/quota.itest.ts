import { testTokens } from '../../providers/testing/tokens.js';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { OPENAI_OAUTH_PROVIDER } from '@runlith/adapter-openai/models/openai';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { Clock, Context, Effect, Layer, Stream } from 'effect';
import { type AccountQuotaProvider, accountQuotaLayer } from '../../providers/quota/ledger.js';
import { AccountQuota } from '../../providers/contract/service/quota.js';
import { subscriptionAccounts } from '../../providers/accounts/stored.js';
import { makeQuotaReadings } from '../../providers/quota/readings.js';
import { accountQuotaReading } from '../../providers/store/tables.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { observeStepQuota } from './quota.js';

const machine = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool)),
);

const credentials: ModelCredentials = {
  apiKey: () => Promise.reject(new Error('unused fake credential')),
  accessToken: () => Promise.reject(new Error('unused fake credential')),
  credential: async () => ({
    accessToken: 'token',
    refreshToken: 'refresh',
    expiresAt: 0,
    scope: '',
    account: { uuid: 'account-uuid', email: 'operator@example.com' },
    organization: { uuid: 'organization-uuid', name: '' },
    accountId: undefined,
  }),
};

const spent = AccountKey.make('spent-account');
const other = AccountKey.make('other-account');

const reply = (usedPercent: number) =>
  new QuotaObservation({
    observedAt: new Date(),
    source: 'reply',
    windows: [new QuotaWindow({ kind: 'session', usedPercent })],
  });

const twoAccounts = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  yield* units.write('observeStepQuota', (unit) => unit.run(db.delete(accountQuotaReading)));
  const tokens = testTokens(join(mkdtempSync(join(tmpdir(), 'observe-step-quota-')), 'tokens.json'));
  for (const accountId of [spent, other]) {
    yield* tokens.add(OPENAI_OAUTH_PROVIDER, {
      accessToken: `access-${accountId}`,
      refreshToken: 'refresh',
      expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
      accountId,
    });
  }
  const provider: AccountQuotaProvider = {
    id: OPENAI_OAUTH_PROVIDER,
    quota: { fromHeaders: () => null, read: () => Effect.never },
  };
  const built = yield* Layer.build(
    accountQuotaLayer(
      'operator',
      subscriptionAccounts(tokens),
      makeQuotaReadings({ db, units }),
      () => [provider],
      () => Effect.succeed({ account: other, revision: 0 }),
      () => credentials,
    ),
  );
  const quota = Context.get(built, AccountQuota);
  yield* quota.changes.pipe(Stream.runHead);
  return quota;
});

layer(machine)('step quota', (it) => {
  it.effect('a reply with quota moves the row of the account the step signed with, and no other', () =>
    Effect.gen(function* () {
      const quota = yield* twoAccounts;

      yield* observeStepQuota(quota, {
        run: { provider: OPENAI_OAUTH_PROVIDER, account: null },
        step: { quota: reply(61), account: spent },
      });

      const table = yield* quota.table();
      expect(table.find((row) => row.account === spent)?.quota).toMatchObject({
        source: 'reply',
        windows: [{ usedPercent: 61 }],
      });
      expect(table.find((row) => row.account === other)?.quota).toBeNull();
    }),
  );

  it.effect('a step that named no account is charged to the run pin', () =>
    Effect.gen(function* () {
      const quota = yield* twoAccounts;

      yield* observeStepQuota(quota, {
        run: { provider: OPENAI_OAUTH_PROVIDER, account: spent },
        step: { quota: reply(42) },
      });

      const table = yield* quota.table();
      expect(table.find((row) => row.account === spent)?.quota).toMatchObject({ windows: [{ usedPercent: 42 }] });
      expect(table.find((row) => row.account === other)?.quota).toBeNull();
    }),
  );

  it.effect('a step with no quota and a run with no account move no row', () =>
    Effect.gen(function* () {
      const quota = yield* twoAccounts;

      yield* observeStepQuota(quota, { run: { provider: OPENAI_OAUTH_PROVIDER, account: spent }, step: {} });
      yield* observeStepQuota(quota, { run: { provider: OPENAI_OAUTH_PROVIDER, account: null }, step: { quota: reply(61) } });
      yield* observeStepQuota(quota, { run: { provider: null, account: spent }, step: { quota: reply(61) } });

      expect((yield* quota.table()).every((row) => row.quota === null)).toBe(true);
    }),
  );
});
