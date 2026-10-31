<script lang="ts">
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import type { ClassValue } from 'svelte/elements';
  import { Pace } from '$lib/features/power/Pace.svelte.js';

  let { class: className }: { class?: ClassValue } = $props();

  const pace = Pace.use();

  const shown = $derived(pace.shown);
</script>

{#if shown !== null}
  <Callout tone="error" title={shown.title} note={shown.note} onDismiss={() => pace.dismiss()} class={className} />
{/if}
