import { AudioDevices } from '@runlith/audio/port/devices';
import type { Player } from '@runlith/audio/port/player';
import type { DeviceRefused } from '@runlith/audio/port/refusal';
import type { SynthesisChoice } from '@runlith/speech/engine/choose';
import type { SpeechSet } from '@runlith/speech/engine/set';
import { Speech } from '@runlith/speech/engine/Speech';
import type { SpeechFailure } from '@runlith/speech/wire/failure';
import { Deferred, Effect, Exit, Fiber, FiberSet, Scope, Stream } from 'effect';
import type { StoreFailure } from '../platform/contract/service/store.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Settings } from '../settings/contract/service/values.js';
import { Speaking, type SpeakRefusal, type VoiceAsk } from './contract/service/speaking.js';
import type { Synthesized, Voiced } from './contract/wire/speaking.js';
import { VOICE_WORDS } from './contract/wire/words.js';
import { voiceChoice } from './keys.js';
import { noModel } from './listening/choice.js';

const failed = (failure: SpeechFailure): GateRefusal<'speech-failed'> =>
  new GateRefusal('speech-failed', `synthesis failed (${failure.reason}): ${failure.message}`, [
    failure.reason === 'auth'
      ? "save the provider's API key, or choose another voice in Settings → Speech"
      : 'speak again, or choose another voice in Settings → Speech',
  ]).saying(VOICE_WORDS.failed);

const refused = (failure: DeviceRefused): GateRefusal<'player-refused'> =>
  new GateRefusal('player-refused', `the sound could not be played (${failure.code}): ${failure.message}`, [
    failure.unblock[0] ?? 'check the output device of the machine running this server',
    ...failure.unblock.slice(1),
  ]).saying(VOICE_WORDS.noPlayer);

const silenced = new GateRefusal('speech-failed', 'this voice was stopped by stop_speaking', ['open a new voice to speak again']).saying(
  VOICE_WORDS.stopped,
);

const voicedOf = (choice: SynthesisChoice): Voiced => ({ provider: choice.provider, model: choice.model.id, voice: choice.voice });

function* audioFrames(pcm: Int16Array, rate: number, channels: number): Generator<Synthesized> {
  const step = Math.min(8192 - (8192 % channels), Math.max(1, Math.floor(rate / 10)) * channels);
  for (let offset = 0; offset < pcm.length; offset += step) {
    const count = Math.min(step, pcm.length - offset);
    const bytes = new Uint8Array(count * 2);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < count; index++) view.setInt16(index * 2, pcm[offset + index]!, true);
    yield { kind: 'audio', pcm: bytes };
  }
}

export const makeSpeaking = Effect.gen(function* () {
  const speech = yield* Speech;
  const devices = yield* AudioDevices;
  const settings = yield* Settings;

  const sessions = new Map<Scope.Closeable, Player | undefined>();
  const fibers = yield* FiberSet.make<void, GateRefusal | StoreFailure>();

  const chosen = Effect.fn('Speaking.chosen')(function* (
    set: SpeechSet,
    ask: VoiceAsk,
  ): Effect.fn.Return<SynthesisChoice, GateRefusal<'no-model'> | StoreFailure> {
    const standing = yield* settings.value(voiceChoice);
    const named = ask.provider === undefined && ask.model === undefined;
    const need = {
      provider: ask.provider ?? (named ? standing.provider : undefined),
      model: ask.model ?? (named ? standing.model : undefined),
      voice: ask.voice ?? (named ? standing.voice : undefined),
      language: ask.language ?? standing.language,
    };
    return yield* Effect.mapError(set.voice(need, ask.account), noModel);
  });

  const speaking: Speaking['Service'] = Speaking.of({
    open: Effect.fn('Speaking.open')(function* (ask) {
      const session = yield* Scope.make();
      sessions.set(session, undefined);
      yield* Effect.addFinalizer(() =>
        Effect.andThen(
          Effect.sync(() => sessions.delete(session)),
          Scope.close(session, Exit.void),
        ),
      );
      const set = yield* Scope.provide(speech.take, session);
      const choice = yield* chosen(set, ask);
      const live = Effect.suspend(() => (sessions.has(session) ? Effect.void : Effect.fail(silenced)));
      const synthesis = yield* Effect.mapError(set.synthesize(choice, { account: ask.account }), failed).pipe(Scope.provide(session));
      const player = yield* Effect.mapError(devices.play(synthesis.format), refused).pipe(Scope.provide(session));
      if (sessions.has(session)) sessions.set(session, player);
      const pumped = yield* Effect.forkIn(
        Stream.runForEach(synthesis.audio, (spoken) => (spoken._tag === 'Audio' ? player.write(spoken.pcm) : Effect.void)),
        session,
      );
      const played = Effect.gen(function* () {
        const exit = yield* Fiber.await(pumped);
        if (!sessions.has(session)) return;
        if (Exit.isFailure(exit)) {
          yield* Fiber.join(pumped).pipe(
            Effect.mapError((failure): GateRefusal<'speech-failed' | 'player-refused'> =>
              failure._tag === 'SpeechFailure' ? failed(failure) : refused(failure),
            ),
          );
        }
        const outcome = yield* Effect.mapError(player.mark('end'), refused);
        yield* outcome;
      });
      return {
        ...voicedOf(choice),
        say: (text: string) => Effect.andThen(live, Effect.mapError(synthesis.say(text), failed)),
        end: Effect.andThen(live, Effect.mapError(synthesis.end, failed)),
        played,
      };
    }),
    speak: Effect.fn('Speaking.speak')(function* (ask) {
      const opened = yield* Deferred.make<Voiced, GateRefusal<SpeakRefusal> | StoreFailure>();
      const job = Effect.scoped(
        Effect.gen(function* () {
          const utterer = yield* speaking.open(ask);
          yield* Deferred.succeed(opened, { provider: utterer.provider, model: utterer.model, voice: utterer.voice });
          yield* utterer.say(ask.text);
          yield* utterer.end;
          yield* utterer.played;
        }),
      ).pipe(
        Effect.onError((cause) => Deferred.failCause(opened, cause)),
        Effect.tapCause((cause) => Effect.logWarning('speaking ended in failure', cause)),
      );
      yield* FiberSet.run(fibers, job);
      return yield* Deferred.await(opened);
    }),
    stop: Effect.gen(function* () {
      const playing = [...sessions];
      sessions.clear();
      yield* Effect.forEach(playing, ([, player]) => (player === undefined ? Effect.void : player.clear), { discard: true });
      yield* FiberSet.clear(fibers);
      yield* Effect.forEach(playing, ([session]) => Scope.close(session, Exit.void), { discard: true });
      return playing.filter(([, player]) => player !== undefined).length;
    }).pipe(Effect.withSpan('Speaking.stop')),
    audio: (ask) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const set = yield* speech.take;
          const choice = yield* chosen(set, ask);
          const synthesis = yield* Effect.mapError(set.synthesize(choice, {}), failed);
          const writing = Stream.fromEffect(Effect.andThen(synthesis.say(ask.text), synthesis.end).pipe(Effect.mapError(failed))).pipe(
            Stream.drain,
          );
          const sounds = synthesis.audio.pipe(
            Stream.mapError(failed),
            Stream.flatMap((spoken) =>
              spoken._tag === 'Audio'
                ? Stream.fromIterable(audioFrames(spoken.pcm, synthesis.format.rate, synthesis.format.channels), { chunkSize: 1 })
                : Stream.empty,
            ),
          );
          const beginning: Synthesized = { kind: 'voice', ...voicedOf(choice), format: synthesis.format };
          return Stream.concat(Stream.succeed(beginning), Stream.merge(sounds, writing));
        }),
      ),
  });
  return speaking;
});
