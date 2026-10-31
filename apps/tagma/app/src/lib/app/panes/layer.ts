import { Layer } from '@runlith/layer/Layer';
import { Panes } from '$lib/shared/panes/pane.js';
import { Topics } from '$lib/shared/threads/Topics.svelte.js';
import { AreaFrame } from './AreaFrame.svelte.js';
import { PaneRegistry } from './PaneRegistry.js';
import { SidePanes } from './SidePanes.svelte.js';
import { TabLayouts } from './TabLayouts.svelte.js';

export const PanesLayer = Layer.mergeAll(Panes, PaneRegistry, SidePanes, AreaFrame, TabLayouts, Topics);
