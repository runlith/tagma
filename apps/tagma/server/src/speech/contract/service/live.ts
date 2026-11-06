import type { Speech } from '@runlith/speech/engine/Speech';
import type { LiveDeclaration } from '../../../platform/contract/service/manifest.js';
import type { SPEECH_FEEDS } from '../wire/feeds.js';
import type { Captures } from './captures.js';
import type { Models } from './models.js';
import type { Recognitions } from './recognitions.js';
import type { Speaking } from './speaking.js';

export type SpeechLive = LiveDeclaration<typeof SPEECH_FEEDS, Recognitions | Captures | Models | Speaking | Speech>;
