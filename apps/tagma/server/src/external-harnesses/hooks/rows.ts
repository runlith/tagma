import { join } from 'node:path';
import { Data, Effect } from 'effect';
import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import { PACKAGE_VARIABLE, type SessionSigner } from '../contract/wire/sessionVariables.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import { declaredHarness } from '../adapter/declared.js';
import { ADAPTERS, dataDirectory } from '../../installation/contract/wire/layout.js';
import type { Channel } from '../../installation/contract/wire/channel.js';
import type { Invocation } from '../../platform/cli/verb.js';

export type HarnessDeclarations = (
  machine: string | null,
  harness: string | null,
  pinned: string | null,
) => Promise<readonly HarnessProvider[]>;

export type HarnessCatalog = { readonly declarations: HarnessDeclarations; readonly signers: readonly SessionSigner[] };

export type HookRows = {
  readonly named: HarnessAdapter | null;
  readonly rows: readonly HarnessAdapter[];
  readonly signers: readonly SessionSigner[];
};

export class HarnessUnreadable extends Data.TaggedError('HarnessUnreadable')<{ readonly harness: string; readonly reason: string }> {
  override get message() {
    return `the installed adapter packages could not be read for ${this.harness}: ${this.reason}`;
  }
}

export const harnessRows = Effect.fnUntraced(function* (
  catalog: () => Promise<HarnessCatalog>,
  at: Invocation,
  channel: Channel,
  harness: string | null,
) {
  const { declarations, signers } = yield* Effect.promise(catalog);
  const data = dataDirectory(channel, at.env);
  const providers = yield* Effect.tryPromise({
    try: () => declarations(data === null ? null : join(data, ADAPTERS), harness, at.env[PACKAGE_VARIABLE] ?? null),
    catch: (cause) =>
      new HarnessUnreadable({ harness: harness ?? 'unnamed hook', reason: cause instanceof Error ? cause.message : String(cause) }),
  }).pipe(Effect.withSpan('hook.installedHarness'));
  if (harness === null) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const { makeHarnessAdapters } = yield* Effect.promise(() => import('../adapters.js'));
        const adapters = yield* makeHarnessAdapters;
        yield* adapters.declared(providers);
        return { named: null, rows: adapters.all(), signers } satisfies HookRows;
      }),
    );
  }
  const provider = providers.find((provider) => provider.id === harness);
  const row = provider === undefined ? null : declaredHarness(provider);
  return row === null ? null : ({ named: row, rows: [row], signers } satisfies HookRows);
});
