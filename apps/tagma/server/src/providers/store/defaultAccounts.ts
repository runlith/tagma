import { AccountKey } from '@runlith/llm/models/authStatus';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import type { DefaultAccount } from '../contract/service/accounts.js';
import { defaultAccount } from './tables.js';

const keyOf = (account: string | null | undefined): AccountKey | null =>
  account === null || account === undefined ? null : AccountKey.make(account);

export const makeAccountDefaultRows = ({ db }: { readonly db: StoreDb<'machine'> }) => ({
  read: (unit: Unit<'machine'>, principalId: string, provider: string): Effect.Effect<DefaultAccount, StoreFailure> =>
    Effect.map(
      unit.run(
        db
          .select({ account: defaultAccount.account, revision: defaultAccount.revision })
          .from(defaultAccount)
          .where(and(eq(defaultAccount.principalId, principalId), eq(defaultAccount.provider, provider)))
          .get(),
      ),
      (row) => ({ account: keyOf(row?.account), revision: row?.revision ?? 0 }),
    ),

  write: (
    unit: WriteUnit<'machine'>,
    principalId: string,
    provider: string,
    standing: DefaultAccount,
    account: string | null,
  ): Effect.Effect<DefaultAccount, StoreFailure> => {
    const after = keyOf(account);
    if (standing.account === after) return Effect.succeed(standing);
    const revision = standing.revision + 1;
    return Effect.as(
      unit.run(
        db
          .insert(defaultAccount)
          .values({ principalId, provider, account: after, revision })
          .onConflictDoUpdate({
            target: [defaultAccount.principalId, defaultAccount.provider],
            set: { account: after, revision },
          }),
      ),
      { account: after, revision },
    );
  },
});

export type AccountDefaultRows = ReturnType<typeof makeAccountDefaultRows>;
