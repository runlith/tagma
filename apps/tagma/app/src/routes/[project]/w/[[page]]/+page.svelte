<script lang="ts">
  import type { PageId } from '@tagma/server/browser/contract/wire/ids';
  import { Router } from '@runlith/layer/Router';
  import Tabs from '$lib/app/mobile/Tabs.svelte';
  import { Host } from '@runlith/layer/Host';
  import PagesScreen from '$lib/features/browser/PagesScreen.svelte';

  const host = Host.use();
  const router = Router.use();
  const pageId = $derived(router.params.page === undefined ? null : (router.params.page as PageId));
</script>

<PagesScreen project={router.params.project ?? ''} {pageId} />
{#if host.kind === 'mobile' && pageId === null}
  <Tabs on="pages" />
{/if}
