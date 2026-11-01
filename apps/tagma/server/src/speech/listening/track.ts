import type { AudioDevices } from '@runlith/audio/port/devices';
import { Meter } from '@runlith/audio/sound/level';
import type { Track } from '@runlith/audio/sound/track';
import type { RecognitionChoice } from '@runlith/speech/engine/choose';
import type { ListeningSettings } from '@runlith/speech/engine/settings';
import type { Speech } from '@runlith/speech/engine/Speech';
import type { Heard as Spoken } from '@runlith/speech/wire/heard';
import { Effect, type Scope, Stream } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Heard, ListeningTrack, TrackAsk } from '../contract/wire/listening.js';
import { captureWords } from '../contract/wire/words.js';

const LEVEL_WINDOW_MS = 100;

const LABELS = { mic: 'Microphone', system: 'System audio' } as const;

export type Outcome = { readonly phase: 'finished' | 'ended' } | { readonly phase: 'failed'; readonly reason: string };

export type Ears<E> = {
  readonly spoken: (spoken: Exclude<Spoken, { readonly _tag: 'Finished' }>) => Effect.Effect<void, E>;
  readonly heard: (heard: Heard) => Effect.Effect<void>;
};

export type Captured = { readonly track: ListeningTrack; readonly capture: Track };

export const named = (asked: readonly TrackAsk[], microphone: string | null): readonly ListeningTrack[] => {
  const seen = new Map<string, number>();
  return asked.map((ask) => {
    const count = (seen.get(ask.source) ?? 0) + 1;
    seen.set(ask.source, count);
    const device = ask.device ?? (ask.source === 'mic' ? (microphone ?? undefined) : undefined);
    return {
      id: count === 1 ? ask.source : `${ask.source}-${count}`,
      source: ask.source,
      label: count === 1 ? LABELS[ask.source] : `${LABELS[ask.source]} ${count}`,
      device,
      echoCancel: ask.echoCancel ?? false,
    };
  });
};

export const capture = (
  devices: AudioDevices['Service'],
  track: ListeningTrack,
): Effect.Effect<Captured, GateRefusal<'capture-refused'>, Scope.Scope> =>
  devices.capture({ source: track.source, device: track.device, echoCancel: track.echoCancel }).pipe(
    Effect.map((captured) => ({ track, capture: captured })),
    Effect.mapError((refused) =>
      new GateRefusal(
        'capture-refused',
        `${track.label} could not be captured (${refused.code}): ${refused.message}`,
        refused.unblock.length > 0 ? [refused.unblock[0]!, ...refused.unblock.slice(1)] : ['choose another source or device'],
      ).saying(captureWords(track.source, refused.code)),
    ),
  );

const metered = <E>(captured: Captured, origin: bigint, ears: Ears<E>): Track => {
  const meter = new Meter(captured.capture.format, LEVEL_WINDOW_MS);
  const id = captured.track.id;
  return {
    ...captured.capture,
    chunks: captured.capture.chunks.pipe(
      Stream.tap((sound) =>
        sound._tag !== 'Chunk'
          ? Effect.void
          : Effect.forEach(
              meter.push(sound),
              (level) => ears.heard({ kind: 'level', track: id, at: Number(level.at - origin) / 1e6, rms: level.rms, peak: level.peak }),
              { discard: true },
            ),
      ),
    ),
  };
};

export const listened = <E>(captured: Captured, origin: bigint, ears: Ears<E>): Captured => ({
  ...captured,
  capture: metered(captured, origin, ears),
});

export const recognized = Effect.fnUntraced(function* <E extends { readonly message: string }>(
  speech: Speech['Service'],
  choice: RecognitionChoice,
  captured: Captured,
  origin: bigint,
  settings: ListeningSettings,
  account: string | undefined,
  ears: Ears<E>,
  cut?: Effect.Effect<void>,
): Effect.fn.Return<Outcome> {
  const id = captured.track.id;
  let finished = false;
  const outcome = yield* Stream.runForEach(
    speech.recognize(choice, captured.capture, {
      track: id,
      origin,
      account,
      settings,
      cut,
    }),
    (spoken): Effect.Effect<void, E> =>
      spoken._tag === 'Finished'
        ? Effect.sync(() => {
            finished = true;
          })
        : ears.spoken(spoken),
  ).pipe(
    Effect.match({
      onFailure: (failure): Outcome => ({ phase: 'failed', reason: failure.message }),
      onSuccess: (): Outcome => ({ phase: finished ? 'finished' : 'ended' }),
    }),
  );
  if (outcome.phase === 'failed') {
    yield* Effect.logWarning('a speech track stopped recognizing', {
      track: id,
      recognizer: `${choice.provider}/${choice.model.id}`,
      reason: outcome.reason,
    });
  }
  yield* ears.heard({
    kind: 'track',
    track: id,
    phase: outcome.phase,
    queuedMs: null,
    retryInMs: null,
    reason: outcome.phase === 'failed' ? outcome.reason : null,
  });
  return outcome;
});
