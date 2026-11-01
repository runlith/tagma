import { SPEECH_BRIDGE } from '@tagma/server/speech/contract/wire/view';
import { Layer } from '@runlith/layer/Layer';
import { SettingSections } from '$lib/features/settings/section.js';
import { TagmaMethods } from '$lib/features/tagma-apps/methods.js';
import { Captures } from './Captures.svelte.js';
import { Check } from './Check.svelte.js';
import { Dictation } from './dictation/Dictation.svelte.js';
import { Global } from './dictation/Global.svelte.js';
import { Targets } from './dictation/Targets.js';
import { Installs } from './Installs.svelte.js';
import { SpeechRepo } from './Repo.js';
import { sections } from './settings.js';
import { speechMethod } from './viewSpeech.js';

export const SpeechLayer = Layer.mergeAll(
  SettingSections.contribute('speech', ...sections),
  TagmaMethods.contribute('speech', {
    declaration: SPEECH_BRIDGE,
    method: ({ door, live, sound }, { projectId }) => speechMethod(door, live, sound, projectId),
  }),
  SpeechRepo,
  Check,
  Installs,
  Dictation,
  Global,
  Targets,
  Captures,
);
