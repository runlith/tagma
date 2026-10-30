import { join } from 'node:path';
import { Data, Effect } from 'effect';
import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import { declaredHarness } from '../adapter/declared.js';
import { BUILTIN_LOADERS } from '../vendors/catalog.js';
import { ADAPTERS, dataDirectory } from '../../installation/contract/wire/layout.js';
import type { Channel } from '../../installation/contract/wire/channel.js';
import type { Invocation } from '../../platform/cli/verb.js';

export type HarnessDeclarations = (machine: string, harness: string | null) => Promise<readonly HarnessProvider[]>;

export type HookRows = { readonly named: HarnessAdapter | null; readonly rows: readonly HarnessAdapter[] };

export class HarnessUnreadable extends Data.TaggedError('HarnessUnreadable')<{ readonly harness: string; readonly reason: string }> {
  override get message() {
    return `the installed adapter packages could not be read for ${this.harness}: ${this.reason}`;
  }
}

export const harnessRows = Effect.fnUntraced(function* (
  installed: HarnessDeclarations,
  at: Invocation,
  channel: Channel,
  harness: string | null,
) {
  const load = harness === null ? undefined : BUILTIN_LOADERS.get(harness);
  if (load !== undefined) {
    const row = yield* Effect.promise(load);
    return { named: row, rows: [row] } satisfies HookRows;
  }
  const data = dataDirectory(channel, at.env);
  const providers =
    data === null
      ? []
      : yield* Effect.tryPromise({
          try: () => installed(join(data, ADAPTERS), harness),
          catch: (cause) =>
            new HarnessUnreadable({ harness: harness ?? 'unnamed hook', reason: cause instanceof Error ? cause.message : String(cause) }),
        }).pipe(Effect.withSpan('hook.installedHarness'));
  if (harness === null) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const { makeHarnessAdapters } = yield* Effect.promise(() => import('../adapters.js'));
        const adapters = yield* makeHarnessAdapters;
        yield* adapters.declared(providers);
        return { named: null, rows: adapters.all() } satisfies HookRows;
      }),
    );
  }
  const provider = providers.find((provider) => provider.id === harness);
  const row = provider === undefined ? null : declaredHarness(provider);
  return row === null ? null : ({ named: row, rows: [row] } satisfies HookRows);
});
