<script lang="ts" module>
  import { cubicOut } from 'svelte/easing';
  import type { TransitionConfig } from 'svelte/transition';

  function roll(_node: Element, { from }: { from: 1 | -1 }): TransitionConfig {
    return { duration: 260, easing: cubicOut, css: (t, u) => `transform: translateY(${from * u * 100}%); opacity: ${t}` };
  }
</script>

<script lang="ts">
  let { text }: { text: string } = $props();
  const cells = $derived(Array.from(text, (char, index) => ({ char, at: text.length - index })));
</script>

<span class="sr-only">{text}</span><span class="roll" aria-hidden="true"
  >{#each cells as cell (cell.at)}<span class="cell"
      >{#key cell.char}<span class="glyph" in:roll={{ from: 1 }} out:roll={{ from: -1 }}>{cell.char}</span>{/key}</span
    >{/each}</span
>

<style>
  .roll {
    display: inline-flex;
    white-space: pre;
    clip-path: inset(0);
  }
  .cell {
    display: inline-grid;
  }
  .glyph {
    grid-area: 1 / 1;
  }
</style>
