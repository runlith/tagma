<script lang="ts">
  import type { MachineEditor } from './Outside.svelte.js';

  let { editor }: { editor: MachineEditor } = $props();
</script>

{#if editor.icon !== null}
  <img src={editor.icon} alt="" class="size-3.5 shrink-0" draggable="false" />
{:else}
  <span class="size-3.5 shrink-0 rounded-sm bg-selected" aria-hidden="true"></span>
{/if}
