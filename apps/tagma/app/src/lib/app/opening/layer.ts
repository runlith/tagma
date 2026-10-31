import { Layer } from '@runlith/layer/Layer';
import { Beside } from '$lib/features/opening/Beside.js';
import { LinkKinds, LinkMenuItems } from '$lib/features/opening/Link.js';
import { LinkRegistry } from '$lib/features/opening/LinkRegistry.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import { ThreadSeats } from '$lib/features/threads/seats/ThreadSeats.svelte.js';
import { SidePanes } from '../panes/SidePanes.svelte.js';
import { besideOf } from './beside.js';

export const OpeningLayer = Layer.mergeAll(
  LinkKinds,
  LinkMenuItems,
  LinkRegistry,
  Opening,
  Layer.provide(Beside, function* () {
    return besideOf(yield* SidePanes, yield* ThreadSeats);
  }),
);
