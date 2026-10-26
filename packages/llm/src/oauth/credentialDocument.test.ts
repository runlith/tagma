import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { decodeDocument } from './credentialDocument';
import { AccountKey } from '../models/authStatus';

it.effect('stored CLI token copies are removed once while independent grants and absent providers survive', () =>
  Effect.gen(function* () {
    const row = {
      key: AccountKey.make('account'),
      label: 'Account',
      addedAt: 1,
      credential: { accessToken: 'grant', refreshToken: null, expiresAt: null },
    };
    const first = yield* decodeDocument(
      '/fixture/tokens.json',
      {
        providers: {
          signed: { account: { ...row, origin: { kind: 'own' } } },
          copied: { account: { ...row, origin: { kind: 'imported', source: '/cli/auth.json' } } },
          absent: { account: { ...row, credential: { vendorField: 'preserved' }, origin: { kind: 'own' } } },
        },
      },
      0,
    );
    expect(first).toEqual({
      value: {
        providers: { signed: { account: row }, copied: {}, absent: { account: { ...row, credential: { vendorField: 'preserved' } } } },
      },
      needsWrite: true,
    });
    const second = yield* decodeDocument('/fixture/tokens.json', first.value, 0);
    expect(second).toEqual({ value: first.value, needsWrite: false });
  }),
);
