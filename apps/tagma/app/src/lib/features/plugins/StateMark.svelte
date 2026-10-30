<script lang="ts">
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import type { HereState } from '$lib/features/plugins/here.js';

  let { state }: { state: HereState } = $props();

  const SAID: Readonly<Record<HereState, string>> = {
    waits: 'Waits on you',
    fails: 'Does not start',
    connecting: 'Connecting',
    update: 'Update',
    ok: '',
    off: 'Off',
  };
</script>

{#if state === 'waits'}
  <span class="size-2 shrink-0 bg-status-open" role="img" aria-label={SAID.waits}></span>
{:else if state === 'fails'}
  <span class="size-2 shrink-0 bg-destructive" role="img" aria-label={SAID.fails}></span>
{:else if state === 'connecting'}
  <Waiting class="size-3" />
{:else if state === 'update' || state === 'off'}
  <span class="text-meta text-muted-foreground">{SAID[state]}</span>
{/if}
