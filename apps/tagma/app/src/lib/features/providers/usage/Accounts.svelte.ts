import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
import type { ServedProvider } from '@tagma/server/providers/contract/wire/catalog';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { ProviderCatalog } from '../Catalog.svelte.js';
import { accountSourceOf } from '../served.js';

export type UsageProvider = {
  readonly provider: string;
  readonly served: ServedProvider;
  readonly rows: readonly AccountQuotaRow[];
  readonly standing: AccountQuotaRow;
};

export const signerOf = (rows: readonly AccountQuotaRow[]): AccountQuotaRow | null =>
  rows.find((row) => row.default) ?? (rows.length === 1 ? rows[0]! : null);

export class UsageAccounts extends Service<UsageAccounts>()('UsageAccounts', { tier: 'app' }) {
  static *make() {
    return new UsageAccounts(yield* Live, yield* Scope, yield* Failure, yield* ProviderCatalog);
  }

  rows = $state.raw<readonly AccountQuotaRow[]>([]);
  known = $state(false);

  constructor(
    live: LiveConnection,
    scope: Scope,
    failure: Failure,
    private readonly catalog: ProviderCatalog,
  ) {
    super();
    const held = live.hold(
      (client) => client['accounts.subscribe']({}),
      (frame) => {
        this.rows = frame;
        this.known = true;
      },
      (reason) => {
        if (reason.kind === 'subscription') failure.report(new Error(reason.message));
      },
    );
    scope.defer(() => held.unsubscribe());
  }

  providers = $derived.by<readonly UsageProvider[]>(() =>
    this.catalog.served.providers.flatMap((served) => {
      const rows = this.of(served.id);
      const standing = rows[0];
      return standing === undefined ? [] : [{ provider: served.id, served, rows, standing }];
    }),
  );

  of(provider: string): readonly AccountQuotaRow[] {
    return this.rows
      .filter((row) => row.provider === provider)
      .sort((left, right) => Number(right.default) - Number(left.default) || left.label.localeCompare(right.label));
  }

  signing(provider: string): readonly AccountQuotaRow[] {
    return this.of(accountSourceOf(this.catalog.models, provider));
  }
}
