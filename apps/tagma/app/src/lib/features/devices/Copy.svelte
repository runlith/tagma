<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import { Button } from '$lib/shared/ui/button/index.js';

  let { text, label }: { text: string; label: string } = $props();

  const SHOWN_MS = 1_500;

  let copied = $state(false);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => (copied = false), SHOWN_MS);
  }
</script>

<Button variant="ghost" size="sm" class="pointer-coarse:h-11 pointer-coarse:px-3" aria-label={label} onclick={() => void copy()}>
  {#if copied}
    <Check class="size-3.5" />
    Copied
  {:else}
    <CopyIcon class="size-3.5" />
    Copy
  {/if}
</Button>
