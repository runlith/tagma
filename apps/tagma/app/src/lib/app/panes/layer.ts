import { Layer } from '@runlith/layer/Layer';
import { Topics } from '$lib/shared/threads/Topics.svelte.js';
import { AreaFrame } from './AreaFrame.svelte.js';
import { SidePanes } from './SidePanes.svelte.js';
import { TabLayouts } from './TabLayouts.svelte.js';

export const PanesLayer = Layer.mergeAll(SidePanes, AreaFrame, TabLayouts, Topics);
