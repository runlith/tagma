<script lang="ts">
  import type { Page } from '@tagma/server/browser/contract/wire/page';
  import { DesktopPages } from '../DesktopPages.svelte.js';
  import CastView from '../screencast/CastView.svelte';
  import { adapterOf } from './adapter.js';
  import NativeView from './NativeView.svelte';

  let { page, panel }: { page: Page; panel: string } = $props();

  const desktop = DesktopPages.use();
  const bridge = desktop.bridge;
  const adapter = $derived(bridge !== null && !desktop.known ? null : adapterOf(page, desktop.host));
</script>

{#if adapter === 'native' && bridge !== null}
  {#key page.id}
    <NativeView page={page.id} {panel} {bridge} />
  {/key}
{:else if adapter === 'cast'}
  {#key page.id}
    <CastView projectId={page.projectId} page={page.id} />
  {/key}
{/if}
