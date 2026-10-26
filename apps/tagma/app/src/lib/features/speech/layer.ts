import { Layer } from '@runlith/layer/Layer';
import { Calls } from './calls/Calls.svelte.js';
import { Captures } from './Captures.svelte.js';
import { Check } from './Check.svelte.js';
import { Dictation } from './dictation/Dictation.svelte.js';
import { Global } from './dictation/Global.svelte.js';
import { Targets } from './dictation/Targets.js';
import { Installs } from './Installs.svelte.js';
import { Library } from './library/Library.svelte.js';
import { CallsRepo } from './library/Repo.js';
import { SpeechRepo } from './Repo.js';

export const SpeechLayer = Layer.mergeAll(SpeechRepo, Check, Installs, Dictation, Global, Targets, Captures, Calls, CallsRepo, Library);
