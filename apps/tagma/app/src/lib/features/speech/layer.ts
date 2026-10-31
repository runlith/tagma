import { Layer } from '@runlith/layer/Layer';
import { SettingSections } from '$lib/features/settings/section.js';
import { Surfaces } from '$lib/features/workspace/surface.js';
import { Panes } from '$lib/shared/panes/pane.js';
import { Calls } from './calls/Calls.svelte.js';
import { Captures } from './Captures.svelte.js';
import { Check } from './Check.svelte.js';
import { Dictation } from './dictation/Dictation.svelte.js';
import { Global } from './dictation/Global.svelte.js';
import { Targets } from './dictation/Targets.js';
import { Installs } from './Installs.svelte.js';
import { Library } from './library/Library.svelte.js';
import { CallsRepo } from './library/Repo.js';
import { panes } from './panes.js';
import { SpeechRepo } from './Repo.js';
import { sections } from './settings.js';
import { surfaces } from './surfaces.js';

export const SpeechLayer = Layer.mergeAll(
  Surfaces.contribute('speech', ...surfaces),
  Panes.contribute('speech', ...panes),
  SettingSections.contribute('speech', ...sections),
  SpeechRepo,
  Check,
  Installs,
  Dictation,
  Global,
  Targets,
  Captures,
  Calls,
  CallsRepo,
  Library,
);
