import { declare, type SectionClaim } from '@runlith/tagma/adapter/declaration';
import type { AdapterHost, AdapterSettings, Provider } from '@runlith/tagma/adapter/provider';
import { Effect, Result } from 'effect';
import type { AdapterState } from '../contract/wire/catalog.js';
import type { AdapterIdentity, AdapterSource } from '../contract/service/registry.js';

export type Loaded = {
  readonly state: AdapterState;
  readonly providers: readonly Provider[];
  readonly settings: AdapterSettings | undefined;
  readonly directory?: string;
};

const failed = (source: AdapterIdentity, reason: string): Loaded => ({
  state: { id: source.id, title: source.title, origin: source.origin, version: source.version, state: 'failed', reason },
  providers: [],
  settings: undefined,
});

const disabled = (source: AdapterIdentity): Loaded => ({
  state: { id: source.id, title: source.title, origin: source.origin, version: source.version, state: 'disabled' },
  providers: [],
  settings: undefined,
});

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export const load = Effect.fn('providers.load')(function* (
  source: AdapterSource,
  host: AdapterHost,
  taken: ReadonlyMap<string, string>,
  sections: ReadonlyMap<string, SectionClaim>,
) {
  if (source.disabled === true) return disabled(source);
  const declared = yield* Effect.result(
    Effect.tryPromise({ try: () => source.load(), catch: reasonOf }).pipe(
      Effect.flatMap((entry) => Effect.try({ try: () => declare(entry, host, taken, sections), catch: reasonOf })),
    ),
  );
  const loaded: Loaded = Result.isSuccess(declared)
    ? {
        state: {
          id: source.id,
          title: source.title,
          origin: source.origin,
          version: source.version,
          state: 'loaded',
          providers: declared.success.providers.map((provider) => provider.id),
        },
        ...declared.success,
        directory: source.directory,
      }
    : failed(source, declared.failure);
  if (loaded.state.state === 'failed')
    yield* Effect.logError('a model provider adapter did not load', { adapter: source.id, reason: loaded.state.reason });
  return loaded;
});
