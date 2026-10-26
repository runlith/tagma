import { cubicOut } from 'svelte/easing';
import { fade, slide, type TransitionConfig } from 'svelte/transition';
import type { Finishing } from './Finishing.svelte.js';

export function fadeOut(node: Element, { finishing, rootId }: { finishing: Finishing; rootId: string }): TransitionConfig {
  if (!finishing.leaving(rootId)) return { duration: 0 };
  return fade(node, { duration: 260, easing: cubicOut });
}

export function leave(node: Element, { finishing, rootId }: { finishing: Finishing; rootId: string }): TransitionConfig {
  if (!finishing.leaving(rootId)) return { duration: 0 };
  const collapse = slide(node, { duration: 280, easing: cubicOut });
  return { ...collapse, css: (t, u) => `${collapse.css?.(t, u) ?? ''}opacity: ${t * t};` };
}
