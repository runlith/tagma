<script lang="ts">
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import { Shortcuts, type Taken } from './Shortcuts.svelte.js';

  let {
    taken,
    size = 'sm',
    class: className = '',
    onclose,
  }: { taken: Taken; size?: 'sm' | 'xs'; class?: string; onclose: () => void } = $props();

  const shortcuts = Shortcuts.use();
  const keymap = Keymap.use();

  function useHere(): void {
    shortcuts.confirm(taken);
    onclose();
  }
</script>

<div class={['flex min-w-0 items-center gap-2 text-small text-muted-foreground', className]} data-taken={taken.by.kind}>
  {#if taken.by.kind === 'shell'}
    <span class="flex-1"
      ><Kbd chord={keymap.spellChord(taken.change.chord)} size="sm" /> is taken by {shortcuts.holderTitle(taken.by)}; press another chord.</span
    >
  {:else}
    <span class="flex-1"><Kbd chord={keymap.spellChord(taken.change.chord)} size="sm" /> runs {shortcuts.holderTitle(taken.by)}.</span>
    <Button variant="outline" {size} onclick={useHere}>Use here</Button>
  {/if}
  <Button variant="ghost" {size} onclick={onclose}>Cancel</Button>
</div>
