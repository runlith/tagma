import type { AudioDevices, Availability } from '@runlith/audio/port/devices';
import { offeredTurns } from '@runlith/speech/engine/choose';
import type { Speech } from '@runlith/speech/engine/Speech';
import type { RecognitionModel, SynthesisModel } from '@runlith/speech/wire/capabilities';
import { Effect } from 'effect';
import type { StoreFailure } from '../platform/contract/service/store.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { Settings } from '../settings/contract/service/values.js';
import { dictationReadiness } from './listening/choice.js';
import type { Models } from './contract/service/models.js';
import type { TrackPlace } from './contract/wire/listening.js';
import type { ModelStatus, SpeechStatus } from './contract/wire/status.js';
import { captureWords, NO_SOUND_WORDS } from './contract/wire/words.js';

const key = (provider: string, model: string) => `${provider}\u0000${model}`;

type Judged = (provider: string, model: string) => Availability;

const recognitionOf = (provider: string, model: RecognitionModel, judged: Judged): ModelStatus => {
  const capabilities = model.recognition;
  const file = capabilities.kind === 'file';
  const recorded = capabilities.kind !== 'stream';
  return {
    provider,
    model: model.id,
    label: model.label,
    kind: file ? 'file' : 'recognition',
    recorded,
    again: recorded,
    speakers: capabilities.speakers,
    availability: judged(provider, model.id),
    turns: file ? [] : [...offeredTurns(model)],
    languages: [...capabilities.languages.codes],
    tuning: file ? [] : capabilities.tuning.map((knob) => ({ ...knob, modes: [...knob.modes] })),
    voices: [],
  };
};

const synthesisOf = (provider: string, model: SynthesisModel, judged: Judged): ModelStatus => ({
  provider,
  model: model.id,
  label: model.label,
  kind: 'synthesis',
  recorded: false,
  again: false,
  speakers: false,
  availability: judged(provider, model.id),
  turns: [],
  languages: [...model.synthesis.languages],
  tuning: [],
  voices: model.synthesis.voices.map((voice) => ({ ...voice, languages: [...voice.languages] })),
});

export const statusOf = Effect.fnUntraced(function* (
  speech: Speech['Service'],
  devices: AudioDevices['Service'],
  models: Models['Service'],
  settings: Settings['Service'],
  mic: TrackPlace,
): Effect.fn.Return<SpeechStatus, GateRefusal<'models-unreadable'> | StoreFailure> {
  const availability = yield* devices.availability;
  const inventory: SpeechStatus['devices'] =
    availability._tag === 'present'
      ? yield* devices.devices.pipe(
          Effect.match({
            onSuccess: (inventory): SpeechStatus['devices'] => ({
              capabilities: devices.capabilities,
              availability,
              inputs: [...inventory.inputs],
              permissions: inventory.permissions,
              refusal: null,
              said: null,
            }),
            onFailure: (refused): SpeechStatus['devices'] => ({
              capabilities: devices.capabilities,
              availability,
              inputs: [],
              permissions: null,
              refusal: refused.message,
              said: captureWords('mic', refused.code).text,
            }),
          }),
        )
      : { capabilities: devices.capabilities, availability, inputs: [], permissions: null, refusal: null, said: NO_SOUND_WORDS.text };
  const judged = yield* speech.status();
  const known = new Map(judged.models.map((model) => [key(model.provider, model.model), model.availability]));
  const absent: Availability = { _tag: 'absent', reason: 'the model is not registered', unblock: [] };
  const availabilityOf: Judged = (provider, model) => known.get(key(provider, model)) ?? absent;
  const local = yield* Effect.mapError(models.list, (refused) => new GateRefusal('models-unreadable', refused.message, ['try again']));
  return {
    devices: inventory,
    detector: judged.detector,
    models: [
      ...speech.recognition.map((offer) => recognitionOf(offer.provider, offer.model, availabilityOf)),
      ...speech.synthesis.map((offer) => synthesisOf(offer.provider, offer.model, availabilityOf)),
    ],
    dictation: yield* dictationReadiness(speech, settings),
    mic,
    local: [...local],
  };
});
