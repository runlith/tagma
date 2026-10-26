import { SvelteMap } from 'svelte/reactivity';

import type { Dialogs } from '../DialogRegistry.svelte.js';

export function trackRootsLikeTheHost(dialogs: Dialogs): { lingering: () => number; stop: () => void } {
  const roots = new SvelteMap<string, symbol>();
  const leaving = new Set<string>();

  const stop = $effect.root(() => {
    $effect(() => {
      const onStack = new Set(dialogs.stack.map((entry) => entry.id));

      for (const entry of dialogs.stack) {
        if (roots.has(entry.id)) continue;
        const rootId = Symbol(entry.id);
        roots.set(entry.id, rootId);
        dialogs.trackRoot(rootId, true, entry.key);
      }

      for (const [id, rootId] of [...roots]) {
        if (onStack.has(id)) continue;
        if (!leaving.has(id)) {
          leaving.add(id);
          continue;
        }
        leaving.delete(id);
        roots.delete(id);
        dialogs.untrackRoot(rootId);
      }
    });
  });

  return { lingering: () => leaving.size, stop };
}
