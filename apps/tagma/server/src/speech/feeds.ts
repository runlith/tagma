import { refusingStream } from '../platform/contract/service/body.js';
import type { Listenings } from './contract/service/listenings.js';
import type { Models } from './contract/service/models.js';
import type { Speaking } from './contract/service/speaking.js';
import type { SpeakAsk } from './contract/wire/speaking.js';
import type { RecognitionPurpose, RecognizerAsk, HeardTrackAsk } from './contract/wire/listening.js';

export const speechChannels = (listenings: Listenings['Service'], models: Models['Service'], speaking: Speaking['Service']) => ({
  'speech.synthesize': (ask: SpeakAsk) => refusingStream(speaking.audio(ask)),
  'speech.install.subscribe': () => models.progress,
  'speech.listening.subscribe': ({ projectId, listening }: { readonly projectId: number; readonly listening: string }) =>
    refusingStream(listenings.watch(projectId, listening)),
  'speech.transcript.subscribe': ({
    projectId,
    listening,
    after,
    stay,
  }: {
    readonly projectId: number;
    readonly listening: string;
    readonly after?: number | undefined;
    readonly stay?: boolean | undefined;
  }) => refusingStream(listenings.transcript(projectId, listening, after ?? 0, stay === true)),
  'speech.captures.subscribe': () => listenings.captures,
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
  }) => refusingStream(listenings.recognize({ id, tracks, recognizer, purpose })),
});
