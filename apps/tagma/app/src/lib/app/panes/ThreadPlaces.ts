import { Service } from '@runlith/layer/key';
import type { PaneContent, PaneOpening } from '$lib/shared/panes/pane.js';
import type { Topic } from '$lib/shared/threads/Topics.svelte.js';
import type { Placement } from './SidePanes.svelte.js';
import type { TabLayouts, TabOpen } from './TabLayouts.svelte.js';

export interface PlacesPort {
  readonly threads: readonly string[];
  place(layouts: TabLayouts, thread: string, content: PaneContent): Placement;
  openFor(layouts: TabLayouts, thread: string, content: PaneContent, how?: TabOpen): PaneOpening;
  ask(topic: Topic): void;
}

export class ThreadPlaces extends Service<PlacesPort>()('ThreadPlaces', { tier: 'app' }) {}
