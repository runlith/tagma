<script lang="ts">
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import { Refusal } from '$lib/wire/refusal.js';

  let { failure, title, onRetry }: { failure: unknown; title: string; onRetry?: (() => void) | undefined } = $props();

  const refusal = $derived(failure instanceof Refusal ? failure : null);
  const reason = $derived(refusal?.reason ?? (failure instanceof Error ? failure.message : String(failure)));
</script>

{#snippet retry()}
  <button
    type="button"
    class="inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-small font-medium text-foreground transition-colors hover:bg-hover"
    onclick={onRetry}
  >
    <RotateCw class="size-3" />Read again
  </button>
{/snippet}

<div class="w-full max-w-2xl" data-reading-failed={refusal?.code ?? 'error'}>
  <Callout tone="error" {title} note={reason} class="bg-background" actions={onRetry === undefined ? undefined : retry}>
    {#if refusal !== null && refusal.unblock.length > 0}
      <div class="grid gap-0.5">
        {#each refusal.unblock as line, index (index)}
          <p class="text-small break-words text-muted-foreground">{line}</p>
        {/each}
      </div>
    {/if}
    {#if refusal !== null}
      <p class="stamp wrap-anywhere text-muted-foreground">{refusal.code}</p>
    {/if}
  </Callout>
</div>
