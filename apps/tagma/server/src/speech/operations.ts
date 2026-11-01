import { AudioDevices } from '@runlith/audio/port/devices';
import { Speech } from '@runlith/speech/engine/Speech';
import type { Raised } from '@runlith/agent/permissions';
import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../platform/contract/service/body.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Settings } from '../settings/contract/service/values.js';
import { Captures } from './contract/service/captures.js';
import { Recognitions } from './contract/service/recognitions.js';
import { type Installing, type ModelRefused, Models } from './contract/service/models.js';
import { Speaking } from './contract/service/speaking.js';
import { SPEECH_OPERATIONS as OPS, type SpeechOperationId } from './contract/wire/operations.js';
import { statusOf } from './status.js';

const modelRefusal = (refused: ModelRefused) => new GateRefusal(refused.code, refused.message, ['speech_status names the local models']);

const installing = (models: ReadonlyArray<Installing>, model: string): readonly Raised[] => {
  const running = models.find((offered) => offered.id === model && offered.received !== null && offered.failure === null);
  return running === undefined || running.received === null
    ? []
    : [
        {
          condition: 'install-running',
          fact: `${running.label} is downloading (${running.received} of ${running.size} bytes); removing it cancels that install`,
        },
      ];
};

export const SPEECH_PAIRS: { readonly [K in SpeechOperationId]: OperationPair<(typeof OPS)[K]> } = {
  finish_recognition: pair(
    OPS.finish_recognition,
    body(OPS.finish_recognition, {
      execute: Effect.fnUntraced(function* (input) {
        yield* (yield* Recognitions).finish(input.id);
        return { status: 'ending' as const, id: input.id };
      }),
    }),
  ),
  stop_capture: pair(
    OPS.stop_capture,
    body(OPS.stop_capture, {
      execute: Effect.fnUntraced(function* (input) {
        if ((input.kind === undefined) !== (input.id === undefined)) {
          return yield* new GateRefusal('selection-shape', 'a capture is named by its kind and its id together', [
            'name both `kind` and `id` to stop one capture, or neither to stop all',
          ]);
        }
        const target = input.kind === undefined || input.id === undefined ? null : { kind: input.kind, id: input.id };
        return { status: 'stopped' as const, stopped: yield* (yield* Captures).stop(target) };
      }),
    }),
  ),
  speak_text: pair(
    OPS.speak_text,
    body(OPS.speak_text, {
      execute: (input) =>
        Effect.map(
          Effect.flatMap(Speaking, (speaking) => speaking.speak(input)),
          (voiced) => ({ status: 'speaking' as const, ...voiced }),
        ),
    }),
  ),
  stop_speaking: pair(
    OPS.stop_speaking,
    body(OPS.stop_speaking, {
      execute: () =>
        Effect.map(
          Effect.flatMap(Speaking, (speaking) => speaking.stop),
          (voices) => ({ status: 'stopped' as const, voices }),
        ),
    }),
  ),
  speech_status: pair(
    OPS.speech_status,
    body(OPS.speech_status, {
      execute: Effect.fnUntraced(function* (_input, _prepared, caller) {
        const mic = caller.actor.kind === 'operator' && caller.actor.deviceId !== undefined ? 'caller' : 'server';
        return {
          status: 'read' as const,
          speech: yield* statusOf(yield* Speech, yield* AudioDevices, yield* Models, yield* Settings, mic),
        };
      }),
    }),
  ),
  install_speech_model: pair(
    OPS.install_speech_model,
    body(OPS.install_speech_model, {
      execute: (input) =>
        Effect.map(
          Effect.mapError(
            Effect.flatMap(Models, (models) => models.install(input.model)),
            modelRefusal,
          ),
          (status) => ({
            status,
            model: input.model,
          }),
        ),
    }),
  ),
  remove_speech_model: pair(
    OPS.remove_speech_model,
    body(OPS.remove_speech_model, {
      prepare: (input) =>
        Effect.map(
          Effect.mapError(
            Effect.flatMap(Models, (models) => models.list),
            modelRefusal,
          ),
          (models) => installing(models, input.model),
        ),
      execute: (input) =>
        Effect.as(
          Effect.mapError(
            Effect.flatMap(Models, (models) => models.remove(input.model)),
            modelRefusal,
          ),
          {
            status: 'removed' as const,
            model: input.model,
          },
        ),
    }),
  ),
};
