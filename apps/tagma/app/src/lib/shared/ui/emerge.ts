import type { Float } from '@runlith/primitives/float.svelte';
import type { Side } from '@runlith/primitives/place';
import type { TransitionConfig } from 'svelte/transition';

const DURATION_MS = 100;
const SHIFT_PX = 8;
const START_SCALE = 0.95;

const TOWARD: Record<Side, readonly [number, number]> = { bottom: [0, -1], top: [0, 1], left: [1, 0], right: [-1, 0] };

export function emerge(_node: Element, float: Float): () => TransitionConfig {
  return () => {
    const [x, y] = TOWARD[float.side ?? 'bottom'];
    return {
      duration: DURATION_MS,
      css: (t, u) =>
        `opacity:${t};transform:translate(${x * u * SHIFT_PX}px,${y * u * SHIFT_PX}px) scale(${START_SCALE + (1 - START_SCALE) * t});`,
    };
  };
}
