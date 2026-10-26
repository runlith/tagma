<script lang="ts">
  let { reason, onRetry }: { reason: string; onRetry: () => void } = $props();
</script>

<div class="flex flex-col items-start gap-1 px-2 py-1" role="alert">
  <p class="text-ui text-foreground">Couldn’t read this project’s agents.</p>
  <p class="text-small text-muted-foreground">{reason}</p>
  <button
    type="button"
    class="mt-1 rounded-md border border-border px-2 py-0.5 text-small text-foreground hover:bg-hover"
    onclick={onRetry}
  >
    Try again
  </button>
</div>
