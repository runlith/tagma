import type { SeamGeometry } from '$lib/shared/seams/Seams.svelte.js';

export const TERMINALS_SEAM: SeamGeometry = {
  key: 'terminals',
  pane: { axis: 'y', base: 300, min: 120, max: 2000, share: 0.7, side: 'start' },
};
