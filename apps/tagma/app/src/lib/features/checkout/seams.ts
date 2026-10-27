import type { SeamGeometry } from '$lib/shared/seams/Seams.svelte.js';

export const CHECKOUT_SEAM: SeamGeometry = { key: 'checkout', pane: { base: 320, min: 240, max: 800, share: 1 / 2 } };

export const CHANGES_SEAM: SeamGeometry = { key: 'changes', pane: { base: 288, min: 144, max: 640, share: 2 / 5 } };

export const LOG_SEAM: SeamGeometry = { key: 'log', pane: { axis: 'y', base: 280, min: 96, max: 2000, share: 0.6, side: 'start' } };
