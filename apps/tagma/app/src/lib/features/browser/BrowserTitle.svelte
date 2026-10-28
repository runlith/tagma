<script lang="ts">
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { partsOf } from './address.js';
  import { OpenPages } from './OpenPages.svelte.js';
  import PageIcon from './PageIcon.svelte';
  import { shownOf } from './panes.js';

  let { pane }: { pane: SidePane } = $props();

  const open = OpenPages.use();
  const shown = $derived(shownOf(pane.id));
  const page = $derived(shown === null || shown.project !== open.aim.projectId ? undefined : open.listing.byId.get(shown.page));
  const label = $derived.by(() => {
    if (shown === null) return 'New page';
    if (page === undefined) return 'Page';
    if (page.title.trim() !== '') return page.title;
    if (page.url === '' || page.url === 'about:blank') return 'New page';
    return partsOf(page.url).host;
  });
</script>

<span class="grid size-3.5 shrink-0 place-items-center"
  ><PageIcon icon={page?.favicon ?? null} loading={page?.live.loading === true} /></span
>
<FadeText text={label} />
