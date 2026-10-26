<script lang="ts">
  import type { Snippet } from 'svelte';
  import { WireState } from './chrome/WireState.svelte.js';
  import { Host } from '@runlith/layer/Host';
  import { Router } from '@runlith/layer/Router';
  import Refused from './Refused.svelte';

  let { children }: { children: Snippet } = $props();

  const wire = WireState.use();
  const host = Host.use();
  const router = Router.use();

  function openInPlace(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest('a[data-artifact]') : null;
    if (!(anchor instanceof HTMLAnchorElement)) return;
    event.preventDefault();
    router.load(anchor.href);
  }
</script>

<svelte:window onclickcapture={host.kind === 'mobile' ? openInPlace : undefined} />

{#if wire.refusal !== null}
  <Refused refusal={wire.refusal} />
{:else}
  {@render children()}
{/if}
