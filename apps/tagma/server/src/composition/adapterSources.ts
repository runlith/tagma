import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { importProviders } from '@runlith/tagma/adapter/loader';
import { Effect, FileSystem, Layer, Stream } from 'effect';
import { ADAPTERS } from '../installation/contract/wire/layout.js';
import { type ProviderPart, ProviderParts } from '../plugins/contract/service/plugins.js';
import { AdapterPlaces, type AdapterSource, AdapterSources } from '../providers/contract/service/registry.js';
import { HOST_MODULES } from './hostModules.generated.js';

const pluginSource = (part: ProviderPart, directory: string): AdapterSource => ({
  id: part.id,
  title: part.title,
  origin: 'plugin',
  version: part.version,
  directory,
  disabled: part.off ? true : undefined,
  load: async () => (await importProviders(directory, HOST_MODULES)).models,
});

const sourcesLayer = (builtins: readonly AdapterSource[]) =>
  Layer.effect(
    AdapterSources,
    Effect.gen(function* () {
      const parts = yield* ProviderParts;
      const sourcesOf = (standing: readonly ProviderPart[]): readonly AdapterSource[] => {
        const off = new Set(standing.flatMap((part) => (part.builtin && part.off ? [part.id] : [])));
        return [
          ...builtins.map((source) => (off.has(source.id) ? { ...source, disabled: true as const } : source)),
          ...standing.flatMap((part) =>
            part.builtin || !part.providers.models || part.directory === null ? [] : [pluginSource(part, part.directory)],
          ),
        ];
      };
      return AdapterSources.of({
        current: () => sourcesOf(parts.current()),
        changes: Stream.map(parts.changes, sourcesOf),
        host: HOST_MODULES,
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
