import { SPEECH_CAPABILITY } from '@tagma/server/speech/contract/wire/view';
import { Layer } from '@runlith/layer/Layer';
import { SettingSections } from '$lib/features/settings/section.js';
import { ViewCapabilities } from '$lib/features/plugin-views/capabilities.js';
import { Actions } from '$lib/features/workspace/action.js';
import { Captures } from './Captures.svelte.js';
import { Check } from './Check.svelte.js';
import { actions } from './dictation/action.js';
import { Dictation } from './dictation/Dictation.svelte.js';
import { Targets } from './dictation/Targets.js';
import { Installs } from './Installs.svelte.js';
import { SpeechRepo } from './Repo.js';
import { sections } from './settings.js';
import { viewSpeech } from './viewSpeech.js';

export const SpeechLayer = Layer.mergeAll(
  SettingSections.contribute('speech', ...sections),
  Actions.contribute('speech', { id: 'speech', area: 'Speech', actions }),
  ViewCapabilities.contribute('speech', { declaration: SPEECH_CAPABILITY, make: viewSpeech }),
  SpeechRepo,
  Check,
  Installs,
  Dictation,
  Targets,
  Captures,
);
