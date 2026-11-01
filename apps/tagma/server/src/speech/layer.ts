import { AudioDevices } from '@runlith/audio/port/devices';
import { Speech } from '@runlith/speech/engine/Speech';
import { Context, Effect, type FileSystem, Layer } from 'effect';
import { Settings } from '../settings/contract/service/values.js';
import { Captures } from './contract/service/captures.js';
import { Recognitions } from './contract/service/recognitions.js';
import { LocalModels, Models } from './contract/service/models.js';
import { Speaking } from './contract/service/speaking.js';
import { makeCaptures } from './listening/captures.js';
import { makeRecognitions } from './listening/hearing.js';
import { makeModels } from './models.js';
import { makeSpeaking } from './speaking.js';

export type SpeechServices = Recognitions | Captures | Speaking | Models;
export type SpeechNeeds = Speech | AudioDevices | LocalModels | Settings | FileSystem.FileSystem;

export const speechLayer: Layer.Layer<SpeechServices, never, SpeechNeeds> = Layer.effectContext(
  Effect.gen(function* () {
    const captures = yield* makeCaptures;
    const recognitions = yield* makeRecognitions({ captures });
    return Context.make(Recognitions, recognitions).pipe(
      Context.add(Captures, captures),
      Context.add(Speaking, yield* makeSpeaking),
      Context.add(Models, yield* makeModels),
    );
  }),
);
