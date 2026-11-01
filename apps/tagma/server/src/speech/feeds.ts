import { refusingStream } from '../platform/contract/service/body.js';
import type { Captures } from './contract/service/captures.js';
import type { Models } from './contract/service/models.js';
import type { Recognitions } from './contract/service/recognitions.js';
import type { Speaking } from './contract/service/speaking.js';
import type { SpeakAsk } from './contract/wire/speaking.js';
import type { RecognitionPurpose, RecognizerAsk, HeardTrackAsk } from './contract/wire/listening.js';

export type SpeechOwners = {
  readonly recognitions: Recognitions['Service'];
  readonly captures: Captures['Service'];
  readonly models: Models['Service'];
  readonly speaking: Speaking['Service'];
};

export const speechChannels = ({ recognitions, captures, models, speaking }: SpeechOwners) => ({
  'speech.synthesize': (ask: SpeakAsk) => refusingStream(speaking.audio(ask)),
  'speech.install.subscribe': () => models.progress,
  'speech.captures.subscribe': () => captures.events,
  'speech.recognize': ({
    id,
    tracks,
    recognizer,
    purpose,
  }: {
    readonly id: string;
    readonly tracks: readonly HeardTrackAsk[];
    readonly recognizer?: RecognizerAsk | undefined;
    readonly purpose?: RecognitionPurpose | undefined;
  }) => refusingStream(recognitions.recognize({ id, tracks, recognizer, purpose })),
});
