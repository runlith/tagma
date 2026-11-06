import { Context, Deferred, Effect, Layer, PubSub, Semaphore, Stream } from 'effect';
import { type AnyProvider, type SpeechPart, speechCatalog } from './catalog.ts';
import { type SpeechSet, speechSet } from './set.ts';
import type { SpeechCredentials } from './SpeechCredentials.ts';
import type { SpeechDetector } from './SpeechDetector.ts';
import { type SpeechHost, SpeechSources } from './SpeechSources.ts';

export class Speech extends Context.Service<
  Speech,
  {
    readonly now: Effect.Effect<SpeechSet>;
    readonly changes: Stream.Stream<SpeechSet>;
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
      const setOf = Effect.fnUntraced(function* (parts: ReadonlyArray<SpeechPart<SpeechHost>>) {
        const catalog = speechCatalog(parts);
        const limits = new Map<string, Map<string, Semaphore.Semaphore>>();
        for (const provider of catalog.providers) limits.set(provider.id, yield* limited(provider));
        return speechSet({ catalog, context, streams: (provider, model) => limits.get(provider)?.get(model) });
      });
      const sets = yield* Effect.acquireRelease(PubSub.sliding<SpeechSet>({ capacity: 1, replay: 1 }), PubSub.shutdown);
      const first = yield* Deferred.make<SpeechSet>();
      let current: SpeechSet | undefined;
      yield* Effect.forkScoped(
        Stream.runForEach(sources.parts, (parts) =>
          Effect.flatMap(setOf(parts), (set) => {
            current = set;
            return Effect.andThen(PubSub.publish(sets, set), Deferred.succeed(first, set));
          }),
        ).pipe(Effect.ensuring(Effect.flatMap(setOf([]), (empty) => Deferred.succeed(first, empty)))),
      );
      const opening = yield* Deferred.await(first);
      const standing = (): SpeechSet => current ?? opening;
      return Speech.of({
        now: Effect.sync(standing),
        changes: Stream.fromPubSub(sets),
      });
    }),
  );
}
