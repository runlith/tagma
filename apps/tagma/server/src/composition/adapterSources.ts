import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { importProviders } from '@runlith/tagma/adapter/loader';
import { Effect, FileSystem, Layer, Stream } from 'effect';
import { ADAPTERS } from '../installation/contract/wire/layout.js';
import { type ProviderPart, ProviderParts } from '../plugins/contract/service/plugins.js';
import { AdapterPlaces, type AdapterSource, AdapterSources, RevisionUnread } from '../providers/contract/service/registry.js';
import { HOST_MODULES } from './hostModules.generated.js';

type Identity = { readonly id: string; readonly title: string; readonly version: string | null; readonly off: boolean };

const pluginSource = (identity: Identity, directory: string): AdapterSource => ({
  id: identity.id,
  title: identity.title,
  origin: 'plugin',
  version: identity.version,
  directory,
  disabled: identity.off ? true : undefined,
  load: async () => (await importProviders(directory, HOST_MODULES)).models,
});

const sourceAt = (directory: string) =>
  Effect.map(
    Effect.tryPromise({
      try: () => importProviders(directory, HOST_MODULES),
      catch: (cause) => new RevisionUnread({ directory, reason: cause instanceof Error ? cause.message : String(cause) }),
    }),
    ({ id, version }) => pluginSource({ id, title: id, version, off: false }, directory),
  );

const sourcesLayer = (builtins: readonly AdapterSource[]) =>
  Layer.effect(
    AdapterSources,
    Effect.gen(function* () {
      const parts = yield* ProviderParts;
      let seen: { readonly parts: readonly ProviderPart[]; readonly sources: readonly AdapterSource[] } | null = null;
      const sourcesOf = (standing: readonly ProviderPart[]): readonly AdapterSource[] => {
        if (seen?.parts === standing) return seen.sources;
        const off = new Set(standing.flatMap((part) => (part.builtin && part.off ? [part.id] : [])));
        const sources = [
          ...builtins.map((source) => (off.has(source.id) ? { ...source, disabled: true as const } : source)),
          ...standing.flatMap((part) =>
            part.builtin || !part.providers.models || part.directory === null ? [] : [pluginSource(part, part.directory)],
          ),
        ];
        seen = { parts: standing, sources };
        return sources;
      };
      return AdapterSources.of({
        current: () => sourcesOf(parts.current()),
        changes: Stream.map(parts.changes, sourcesOf),
        at: sourceAt,
      });
    }),
  );

const retired = (data: string | null) =>
  data === null
    ? Layer.empty
    : Layer.effectDiscard(
        Effect.orDie(
          Effect.flatMap(FileSystem.FileSystem, (files) => files.remove(join(data, ADAPTERS), { recursive: true, force: true })),
        ),
      ).pipe(Layer.provide(BunFileSystem.layer));

export const adapterSourcesLayer = (data: string | null, builtins: readonly AdapterSource[]) =>
  Layer.mergeAll(sourcesLayer(builtins), Layer.succeed(AdapterPlaces, { data }), retired(data));
