<script lang="ts">
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import type { ErrorBoundaryFallbackProps } from '@runlith/error-boundary/types';

  let { error, canRetry, retry }: ErrorBoundaryFallbackProps = $props();

  const message = $derived(error instanceof Error ? error.message : String(error));
</script>

<div role="alert" data-part-failed class="flex min-w-0 items-start gap-2 rounded-md border border-border bg-raised px-3 py-2 text-small">
  <CircleAlert class="mt-0.5 size-3.5 shrink-0 text-destructive" />
  <div class="grid min-w-0 flex-1 gap-0.5">
    <b class="font-medium text-destructive">This part failed</b>
    <p class="stamp text-meta break-words whitespace-pre-wrap text-muted-foreground select-text">{message}</p>
  </div>
  {#if canRetry}
    <button
      type="button"
      class="shrink-0 rounded-md border border-border px-2 py-0.5 text-small hover:bg-hover"
      onclick={() => void retry()}>Reset</button
    >
  {/if}
</div>
