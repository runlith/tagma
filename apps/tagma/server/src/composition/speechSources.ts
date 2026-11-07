import { type SpeechFault, type SpeechPart, speechCatalog } from '@runlith/speech/engine/catalog';
import { Speech } from '@runlith/speech/engine/Speech';
import { SpeechSources, type SpeechStanding } from '@runlith/speech/engine/SpeechSources';
import type { AnyProvider, SpeechHost } from '@runlith/speech/protocol/adapter';
import { importProviders } from '@runlith/tagma/adapter/loader';
import { Context, Effect, Layer, Predicate, PubSub, type Scope, Stream } from 'effect';
import { PluginFaults, PluginRevisions, type ProviderPart, ProviderParts } from '../plugins/contract/service/plugins.js';
import { PROVIDER_FAULTS } from '../plugins/contract/wire/rows.js';
import { KeyedProviders } from '../providers/contract/service/credentials.js';
import { ProviderRegistry } from '../providers/contract/service/registry.js';
import { HOST_MODULES } from './hostModules.generated.js';

export type BuiltinSpeech = ReadonlyMap<string, ReadonlyArray<AnyProvider<SpeechHost>>>;

type Parts = ReadonlyArray<SpeechPart<SpeechHost>>;

export class SpeechParts extends Context.Service<
  SpeechParts,
  {
    current(): Parts;
    readonly changes: Stream.Stream<Parts>;
  }
>()('tagma/composition/SpeechParts') {}

const NONE: ReadonlyArray<AnyProvider<SpeechHost>> = [];

const samePart = (left: SpeechPart<SpeechHost>, right: SpeechPart<SpeechHost>): boolean =>
  left.owner === right.owner &&
  left.revision === right.revision &&
  ('failure' in left ? 'failure' in right && left.failure === right.failure : 'providers' in right && left.providers === right.providers);

const sameParts = (left: Parts, right: Parts): boolean =>
  left.length === right.length && left.every((part, index) => samePart(part, right[index]!));

const sameTaken = (left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean =>
  left.size === right.size && [...left].every(([id, owner]) => right.get(id) === owner);

const revisionsOf = (parts: Parts): ReadonlySet<string> =>
  new Set(parts.flatMap((part) => (part.revision === undefined ? [] : [part.revision])));

const keyedOf = (parts: Parts): ReadonlyArray<string> =>
  speechCatalog(parts)
    .providers.filter((provider) => provider.credential._tag === 'required')
    .map((provider) => provider.id);

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const speechPartsWith = (builtins: BuiltinSpeech) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const rows = yield* ProviderParts;
      const revisions = yield* PluginRevisions;
      const imported = new Map<string, SpeechPart<SpeechHost>>();
      const importedOf = (row: ProviderPart, directory: string): Effect.Effect<SpeechPart<SpeechHost>> => {
        const known = imported.get(directory);
        if (known !== undefined) return Effect.succeed(known);
        return Effect.tryPromise({ try: () => importProviders(directory, HOST_MODULES), catch: reasonOf }).pipe(
          Effect.match({
            onSuccess: (loaded): SpeechPart<SpeechHost> => ({ owner: row.id, revision: directory, providers: loaded.speech ?? NONE }),
            onFailure: (reason): SpeechPart<SpeechHost> =>
              row.providers.models
                ? { owner: row.id, revision: directory, providers: NONE }
                : { owner: row.id, revision: directory, failure: reason },
          }),
          Effect.tap((part) => Effect.sync(() => imported.set(directory, part))),
        );
      };
      const partOf = (row: ProviderPart): Effect.Effect<SpeechPart<SpeechHost> | null, never, Scope.Scope> => {
        if (row.directory === null) return Effect.succeed({ owner: row.id, providers: builtins.get(row.id) ?? NONE });
        const directory = row.directory;
        return Effect.flatMap(revisions.hold(directory), (held) => (held ? importedOf(row, directory) : Effect.succeed(null)));
      };
      let latest: Parts = [];
      let keyed: ReadonlyArray<string> = [];
      yield* revisions.register({ standing: () => revisionsOf(latest) });
      const published = yield* Effect.acquireRelease(PubSub.sliding<Parts>({ capacity: 1, replay: 1 }), PubSub.shutdown);
      const settled = (current: readonly ProviderPart[]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const found = yield* Effect.forEach(
              current.filter((row) => row.providers.speech && !row.off),
              partOf,
            );
            if (found.some((part) => part === null)) return false;
            const next = found.flatMap((part) => (part === null ? [] : [part]));
            if (sameParts(next, latest)) return true;
            latest = next;
            keyed = keyedOf(next);
            yield* PubSub.publish(published, next);
            return true;
          }),
        );
      const reload = (current: readonly ProviderPart[]): Effect.Effect<void> =>
        Effect.flatMap(settled(current), (done) => (done ? Effect.void : Effect.suspend(() => reload(rows.current()))));
      yield* reload(rows.current());
      yield* Effect.forkScoped(Stream.runForEach(rows.changes, reload));
      return Context.make(SpeechParts, SpeechParts.of({ current: () => latest, changes: Stream.fromPubSub(published) })).pipe(
        Context.add(KeyedProviders, KeyedProviders.of({ ids: () => keyed })),
      );
    }),
  );

const declaredIds = (parts: Parts): ReadonlySet<string> =>
  new Set(
    parts.flatMap((part) =>
      'failure' in part
        ? []
        : part.providers.flatMap((provider): string[] => {
            const id: unknown = Predicate.isObject(provider) ? provider['id'] : undefined;
            return typeof id === 'string' ? [id] : [];
          }),
    ),
  );

const takenOf = (parts: Parts, models: ReadonlyArray<{ readonly id: string; readonly plugin: string }>): ReadonlyMap<string, string> => {
  const speaking = declaredIds(parts);
  return new Map(models.filter((provider) => speaking.has(provider.id)).map((provider) => [provider.id, provider.plugin]));
};

export const speechSourcesWith = <R>(localOf: Effect.Effect<BuiltinSpeech, never, R>) =>
  Layer.effect(
    SpeechSources,
    Effect.gen(function* () {
      const local = yield* localOf;
      const parts = yield* SpeechParts;
      const registry = yield* ProviderRegistry;
      const filled = (raw: Parts): Parts =>
        raw.map((part) =>
          part.revision === undefined && 'providers' in part && local.has(part.owner)
            ? { ...part, providers: local.get(part.owner)! }
            : part,
        );
      const read = () => {
        const raw = parts.current();
        return { raw, taken: takenOf(raw, registry.current().served.providers) };
      };
      let seen = read();
      let latest: SpeechStanding = { parts: filled(seen.raw), taken: seen.taken };
      const published = yield* Effect.acquireRelease(PubSub.sliding<SpeechStanding>({ capacity: 1, replay: 1 }), PubSub.shutdown);
      yield* PubSub.publish(published, latest);
      const refresh = Effect.suspend(() => {
        const next = read();
        if (sameParts(next.raw, seen.raw) && sameTaken(next.taken, seen.taken)) return Effect.void;
        seen = next;
        latest = { parts: filled(next.raw), taken: next.taken };
        return Effect.asVoid(PubSub.publish(published, latest));
      });
      yield* Effect.forkScoped(Stream.runForEach(Stream.merge(parts.changes, registry.changes), () => refresh));
      return SpeechSources.of({ current: () => latest, changes: Stream.fromPubSub(published) });
    }),
  );

const detailOf = (fault: SpeechFault): string => (fault.provider === undefined ? fault.reason : `${fault.provider}: ${fault.reason}`);

export const speechHolding = Layer.effectDiscard(
  Effect.gen(function* () {
    const speech = yield* Speech;
    const revisions = yield* PluginRevisions;
    const faults = yield* PluginFaults;
    yield* revisions.register({ standing: speech.revisions });
    yield* Effect.forkScoped(Stream.runForEach(speech.released, () => revisions.released));
    yield* Effect.forkScoped(
      Stream.runForEach(speech.changes, (set) =>
        Effect.sync(() =>
          faults.replace(
            PROVIDER_FAULTS.speech,
            new Map(
              [...Map.groupBy(set.faults, (fault) => fault.owner)].map(([owner, found]) => [
                owner,
                { title: 'Some of its speech providers could not be used.', detail: found.map(detailOf).join('\n') },
              ]),
            ),
          ),
        ),
      ),
    );
  }),
);
