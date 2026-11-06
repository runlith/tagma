<script lang="ts">
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import type { StepTone } from '$lib/features/plugins/here.js';

  let { tone }: { tone: StepTone } = $props();
</script>

<span class="grid h-5 place-items-center">
  {#if tone === 'busy'}
    <Waiting class="size-3" />
  {:else}
    <span
      class={[
        'size-2',
        tone === 'waits' && 'bg-status-open',
        tone === 'fails' && 'bg-destructive',
        tone === 'done' && 'bg-status-done',
        tone === 'idle' && 'border border-dashed border-muted-foreground',
      ]}
    ></span>
  {/if}
</span>
