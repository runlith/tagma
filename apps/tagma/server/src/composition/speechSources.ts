import type { AnyProvider, SpeechFault, SpeechPart } from '@runlith/speech/engine/catalog';
import { Speech } from '@runlith/speech/engine/Speech';
import { type SpeechHost, SpeechSources } from '@runlith/speech/engine/SpeechSources';
import { importProviders } from '@runlith/tagma/adapter/loader';
import { Context, Effect, Layer, Predicate, type Scope, Stream } from 'effect';
import { PluginFaults, PluginRevisions, type ProviderPart, ProviderParts } from '../plugins/contract/service/plugins.js';
import { PROVIDER_FAULTS } from '../plugins/contract/wire/rows.js';
import { KeyedProviders } from '../providers/contract/service/credentials.js';
import { HOST_MODULES } from './hostModules.generated.js';

export type BuiltinSpeech = ReadonlyMap<string, ReadonlyArray<AnyProvider<SpeechHost>>>;

const keyed = (entry: unknown): entry is AnyProvider<SpeechHost> =>
  Predicate.isObject(entry) &&
  typeof entry['id'] === 'string' &&
  Predicate.isObject(entry['credential']) &&
  entry['credential']['_tag'] === 'required';

const keyedOf = (parts: ReadonlyArray<SpeechPart<SpeechHost>>): ReadonlyArray<string> =>
  parts.flatMap((part) => part.providers.filter(keyed).map((provider) => provider.id));

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const speechSourcesWith = <R>(builtinsOf: Effect.Effect<BuiltinSpeech, never, R>) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const builtins = yield* builtinsOf;
      const rows = yield* ProviderParts;
      const imported = new Map<string, SpeechPart<SpeechHost>>();
      const importedOf = (row: ProviderPart, directory: string): Effect.Effect<SpeechPart<SpeechHost>> => {
        const known = imported.get(directory);
        if (known !== undefined) return Effect.succeed(known);
        return Effect.tryPromise({ try: () => importProviders(directory, HOST_MODULES), catch: reasonOf }).pipe(
          Effect.match({
            onSuccess: (loaded): SpeechPart<SpeechHost> => ({ owner: row.id, revision: directory, providers: loaded.speech ?? [] }),
            onFailure: (reason): SpeechPart<SpeechHost> => ({
              owner: row.id,
              revision: directory,
              providers: [],
              failure: row.providers.models ? undefined : reason,
            }),
          }),
          Effect.tap((part) => Effect.sync(() => imported.set(directory, part))),
        );
      };
      const revisions = yield* PluginRevisions;
      let standing: ReadonlyArray<SpeechPart<SpeechHost>> = [];
      yield* revisions.register({
        standing: () => new Set(standing.flatMap((part) => (part.revision === undefined ? [] : [part.revision]))),
      });
      const partOf = (row: ProviderPart): Effect.Effect<ReadonlyArray<SpeechPart<SpeechHost>> | null, never, Scope.Scope> => {
        if (row.directory === null) {
          const own = builtins.get(row.id);
          return Effect.succeed(own === undefined ? [] : [{ owner: row.id, providers: own }]);
        }
        const directory = row.directory;
        return Effect.flatMap(revisions.hold(directory), (held) =>
          held ? Effect.map(importedOf(row, directory), (part) => [part]) : Effect.succeed(null),
        );
      };
      const settled = (current: readonly ProviderPart[]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const found = yield* Effect.forEach(
              current.filter((row) => row.providers.speech && !row.off),
              partOf,
            );
            if (found.some((part) => part === null)) return null;
            const next = found.flatMap((part) => part ?? []);
            standing = next;
            return next;
          }),
        );
      const reload = (current: readonly ProviderPart[]): Effect.Effect<ReadonlyArray<SpeechPart<SpeechHost>>> =>
        Effect.flatMap(settled(current), (next) => (next === null ? Effect.suspend(() => reload(rows.current())) : Effect.succeed(next)));
      yield* reload(rows.current());
      const parts = Stream.mapEffect(rows.changes, reload);
      return Context.make(SpeechSources, SpeechSources.of({ parts })).pipe(
        Context.add(KeyedProviders, KeyedProviders.of({ ids: () => keyedOf(standing) })),
      );
    }),
  );

const detailOf = (fault: SpeechFault): string => (fault.provider === '' ? fault.reason : `${fault.provider}: ${fault.reason}`);

export const speechHolding = Layer.effectDiscard(
  Effect.gen(function* () {
    const speech = yield* Speech;
    const revisions = yield* PluginRevisions;
    const faults = yield* PluginFaults;
    yield* revisions.register({ standing: speech.revisions });
    yield* Effect.forkScoped(Stream.runForEach(speech.released, () => revisions.released));
    let faulted = new Set<string>();
    yield* Effect.forkScoped(
      Stream.runForEach(speech.changes, (set) =>
        Effect.sync(() => {
          const owners = Map.groupBy(set.faults, (fault) => fault.owner);
          for (const owner of faulted) if (!owners.has(owner)) faults.clear(owner, PROVIDER_FAULTS.speech);
          for (const [owner, found] of owners)
            faults.put(owner, PROVIDER_FAULTS.speech, {
              title: 'Some of its speech providers could not be used.',
              detail: found.map(detailOf).join('\n'),
            });
          faulted = new Set(owners.keys());
        }),
      ),
    );
  }),
);
