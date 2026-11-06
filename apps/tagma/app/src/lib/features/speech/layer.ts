import { SPEECH_BRIDGE } from '@tagma/server/speech/contract/wire/view';
import { Layer } from '@runlith/layer/Layer';
import { SettingSections } from '$lib/features/settings/section.js';
import { TagmaMethods } from '$lib/features/plugin-views/methods.js';
import { Actions } from '$lib/features/workspace/action.js';
import { Captures } from './Captures.svelte.js';
import { Check } from './Check.svelte.js';
import { actions } from './dictation/action.js';
import { Dictation } from './dictation/Dictation.svelte.js';
import { Targets } from './dictation/Targets.js';
import { Installs } from './Installs.svelte.js';
import { SpeechRepo } from './Repo.js';
import { sections } from './settings.js';
import { speechMethod } from './viewSpeech.js';

export const SpeechLayer = Layer.mergeAll(
  SettingSections.contribute('speech', ...sections),
  Actions.contribute('speech', { id: 'speech', area: 'Speech', actions }),
  TagmaMethods.contribute('speech', {
    declaration: SPEECH_BRIDGE,
    method: ({ door, live, sound }, { projectId }) => speechMethod(door, live, sound, projectId),
  }),
  SpeechRepo,
  Check,
  Installs,
  Dictation,
  Targets,
  Captures,
);
