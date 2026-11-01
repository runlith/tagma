import type { LiveDeclaration } from '../../../platform/contract/service/manifest.js';
import type { SPEECH_FEEDS } from '../wire/feeds.js';
import type { Captures } from './captures.js';
import type { Listenings } from './listenings.js';
import type { Models } from './models.js';
import type { Recognitions } from './recognitions.js';
import type { Speaking } from './speaking.js';

export type SpeechLive = LiveDeclaration<typeof SPEECH_FEEDS, Listenings | Recognitions | Captures | Models | Speaking>;
