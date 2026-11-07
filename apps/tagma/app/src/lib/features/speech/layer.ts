import { Layer } from '@runlith/layer/Layer';
import { SettingSections } from '$lib/features/settings/section.js';
import { viewCapability } from '$lib/features/plugin-views/capabilities.js';
import { Actions } from '$lib/features/workspace/action.js';
import { Captures } from './Captures.svelte.js';
import { StatusRefresh } from './StatusRefresh.js';
import { Check } from './Check.svelte.js';
import { actions } from './dictation/action.js';
import { Dictation } from './dictation/Dictation.svelte.js';
import { Targets } from './dictation/Targets.js';
import { Installs } from './Installs.svelte.js';
import { SpeechRepo } from './Repo.js';
import { sections } from './settings.js';
import { SpeechCapability } from './viewSpeech.js';

export const SpeechLayer = Layer.mergeAll(
  SettingSections.contribute('speech', ...sections),
  Actions.contribute('speech', { id: 'speech', area: 'Speech', actions }),
  viewCapability(SpeechCapability),
  SpeechRepo,
  Check,
  Installs,
  StatusRefresh,
  Dictation,
  Targets,
  Captures,
);
