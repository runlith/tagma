<script lang="ts">
  import { Seam } from '@runlith/seam/Seam.svelte';
  import SeamHandle from '@runlith/seam/SeamHandle.svelte';
  import { nodeAt, paneIds, type SplitDirection, type SplitPath } from './paneLayout.js';
  import type { TerminalTab } from './Tab.svelte.js';

  const MIN_PANE_PX = 50;

  let {
    tab,
    path,
    direction,
    thickness,
    hidden,
  }: {
    tab: TerminalTab;
    path: SplitPath;
    direction: SplitDirection;
    thickness: number;
    hidden: boolean;
  } = $props();

  const split = () => {
    const node = nodeAt(tab.layout, path);
    return node?.kind === 'split' ? node : null;
  };

  function holdBothSides(): () => void {
    const node = split();
    const held = node === null ? [] : paneIds(node).flatMap((id) => tab.panes.get(id)?.holdResize() ?? []);
    return () => {
      tab.refit();
      for (const release of held) release();
    };
  }

  const seam = new Seam(
    {
      get axis() {
        return direction === 'row' ? 'x' : 'y';
      },
      base: 0,
      min: MIN_PANE_PX,
      max: Number.POSITIVE_INFINITY,
      rest: MIN_PANE_PX,
      get fill() {
        return split()?.ratio ?? 0.5;
      },
    },
    {
      onGrab: holdBothSides,
      onDrag: (_size, fill) => tab.resize(path, fill),
      onCommit: (_size, fill) => tab.resize(path, fill),
      onReset: () => {
        tab.resize(path, 0.5);
        tab.refit();
      },
    },
  );
</script>

{#if !hidden}
  <SeamHandle {seam} label="Resize the split" contained line={thickness} />
{/if}
