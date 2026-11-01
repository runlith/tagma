import { SPEECH_NOTIFICATION } from '@tagma/server/speech/contract/wire/view';
import { Layer } from '@runlith/layer/Layer';
import { SettingSections } from '$lib/features/settings/section.js';
import { TagmaMethods } from '$lib/features/tagma-apps/methods.js';
import { Surfaces } from '$lib/features/workspace/surface.js';
import { Panes } from '$lib/shared/panes/pane.js';
import { StagedKinds } from '$lib/shared/threads/staged.js';
import { TopBarParts, WindowParts } from '$lib/shared/window/parts.js';
import CallChip from './calls/CallChip.svelte';
import CallKeys from './calls/CallKeys.svelte';
import { Calls } from './calls/Calls.svelte.js';
import { pieceKind } from './calls/piece.js';
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
import { speechMethod } from './viewSpeech.js';

export const SpeechLayer = Layer.mergeAll(
  Surfaces.contribute('speech', ...surfaces),
  Panes.contribute('speech', ...panes),
  SettingSections.contribute('speech', ...sections),
  TopBarParts.contribute('speech', { id: 'call', order: 10, payload: { component: CallChip } }),
  WindowParts.contribute('speech', { id: 'call-keys', order: 10, payload: { component: CallKeys } }),
  StagedKinds.contribute('speech', pieceKind),
  TagmaMethods.contribute('speech', {
    name: 'speech',
    notifications: [SPEECH_NOTIFICATION],
    method: ({ door, live, sound }, { projectId }) => speechMethod(door, live, sound, projectId),
  }),
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
