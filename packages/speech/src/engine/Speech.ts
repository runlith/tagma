import { Context, Effect, Layer, PubSub, type Scope, Semaphore, Stream } from 'effect';
import type { AnyProvider, SpeechHost } from '../protocol/adapter.ts';
import { type SpeechPart, speechCatalog } from './catalog.ts';
import { type SpeechSet, speechSet } from './set.ts';
import type { SpeechCredentials } from './SpeechCredentials.ts';
import type { SpeechDetector } from './SpeechDetector.ts';
import { SpeechSources, type SpeechStanding } from './SpeechSources.ts';

const revisionsOf = (parts: ReadonlyArray<SpeechPart<SpeechHost>>): ReadonlySet<string> =>
  new Set(parts.flatMap((part) => (part.revision === undefined ? [] : [part.revision])));

type Standing = {
  readonly source: SpeechStanding;
  readonly set: SpeechSet;
  readonly revisions: ReadonlySet<string>;
  holds: number;
};

export class Speech extends Context.Service<
  Speech,
  {
    readonly now: Effect.Effect<SpeechSet>;
    readonly take: Effect.Effect<SpeechSet, never, Scope.Scope>;
    readonly changes: Stream.Stream<SpeechSet>;
    readonly released: Stream.Stream<void>;
  }
>()('speech/Speech') {
  static readonly layer: Layer.Layer<Speech, never, SpeechSources | SpeechHost | SpeechCredentials | SpeechDetector> = Layer.effect(
    Speech,
    Effect.gen(function* () {
      const sources = yield* SpeechSources;
      const context = yield* Effect.context<SpeechHost | SpeechCredentials | SpeechDetector>();
      const permits = new WeakMap<AnyProvider<SpeechHost>, Map<string, Semaphore.Semaphore>>();
      const limited = Effect.fnUntraced(function* (provider: AnyProvider<SpeechHost>) {
        const known = permits.get(provider);
        if (known !== undefined) return known;
        const own = new Map<string, Semaphore.Semaphore>();
        for (const model of provider.synthesizer?.models ?? []) {
          const streams = model.synthesis.limits.streams;
          if (streams !== undefined) own.set(model.id, yield* Semaphore.make(streams));
        }
        permits.set(provider, own);
        return own;
      });
      const standingOf = Effect.fnUntraced(function* (source: SpeechStanding) {
        const catalog = speechCatalog(source.parts, source.taken);
        const limits = new Map<string, Map<string, Semaphore.Semaphore>>();
        for (const provider of catalog.providers) limits.set(provider.id, yield* limited(provider));
        const set = speechSet({ catalog, context, streams: (provider, model) => limits.get(provider)?.get(model) });
        return { source, set, revisions: revisionsOf(source.parts), holds: 0 } satisfies Standing;
      });
      const live = new Set<Standing>();
      let building: ReadonlySet<string> = new Set();
      yield* sources.hold(() => new Set([...building, ...[...live].flatMap((standing) => [...standing.revisions])]));
      const built = (source: SpeechStanding) => {
        building = revisionsOf(source.parts);
        return standingOf(source).pipe(
          Effect.tap((standing) => Effect.sync(() => live.add(standing))),
          Effect.ensuring(
            Effect.sync(() => {
              building = new Set();
            }),
          ),
        );
      };
      let latest: Standing = yield* built(sources.current());
      const sets = yield* Effect.acquireRelease(PubSub.sliding<SpeechSet>({ capacity: 1, replay: 1 }), PubSub.shutdown);
      const releases = yield* Effect.acquireRelease(PubSub.sliding<void>({ capacity: 1 }), PubSub.shutdown);
      yield* PubSub.publish(sets, latest.set);
      const replace = (next: Standing) =>
        Effect.suspend(() => {
          const previous = latest;
          latest = next;
          if (previous.holds > 0) return PubSub.publish(sets, next.set);
          live.delete(previous);
          return Effect.andThen(PubSub.publish(sets, next.set), PubSub.publish(releases, undefined));
        });
      yield* Effect.forkScoped(
        Stream.runForEach(sources.changes, () =>
          Effect.suspend(() => {
            const source = sources.current();
            return source === latest.source ? Effect.void : Effect.flatMap(built(source), replace);
          }),
        ),
      );
      const current = (): Standing => latest;
      const release = (standing: Standing) =>
        Effect.suspend(() => {
          standing.holds -= 1;
          if (standing.holds > 0 || standing === current()) return Effect.void;
          live.delete(standing);
          return PubSub.publish(releases, undefined);
        });
      return Speech.of({
        now: Effect.sync(() => current().set),
        take: Effect.map(
          Effect.acquireRelease(
            Effect.sync(() => {
              const standing = current();
              standing.holds += 1;
              return standing;
            }),
            release,
          ),
          (standing) => standing.set,
        ),
        changes: Stream.fromPubSub(sets),
        released: Stream.fromPubSub(releases),
      });
    }),
  );
}
