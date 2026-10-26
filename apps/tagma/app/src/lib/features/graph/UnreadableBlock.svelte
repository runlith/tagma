<script lang="ts">
  import { Button } from '$lib/shared/ui/button/index.js';
  import { toldOf } from '$lib/wire/refusal.js';

  let { error, retry }: { error: unknown; retry: () => void } = $props();

  const told = $derived(toldOf(error));
</script>

<div class="grid h-full place-items-center px-6">
  <div class="flex max-w-sm flex-col items-center text-center">
    <h1 class="text-page">Could not read this block</h1>
    <p class="mt-2 text-body leading-relaxed text-muted-foreground">{told.text}</p>
    <Button class="mt-4" variant="outline" size="sm" onclick={retry}>Try again</Button>
  </div>
</div>
