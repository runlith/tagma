<script lang="ts">
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { Holding } from './Holders.svelte.js';

  let { holder, class: className }: { holder: Holding; class?: string } = $props();

  const addresses = Addresses.use();
  const href = $derived(holder.home === null ? null : addresses.thread(holder.thread, holder.home));
</script>

<FadeText
  class={className}
  data-pane-holder
  title={href === null ? `This terminal is held by ${holder.label}` : `This terminal is held by ${holder.label} — open the thread`}
>
  held by
  {#if href !== null}
    <a {href} class="underline-offset-2 hover:text-foreground hover:underline" data-pane-holder-thread={holder.thread}>{holder.label}</a>
  {:else}
    {holder.label}
  {/if}
</FadeText>
