<script lang="ts">
  import Globe from '@lucide/svelte/icons/globe';
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { OpenPages } from './OpenPages.svelte.js';
  import { shownOf } from './panes.js';

  let { pane }: { pane: SidePane } = $props();

  const open = OpenPages.use();
  const shown = $derived(shownOf(pane.id));
  const page = $derived(shown === null || shown.project !== open.aim.projectId ? undefined : open.listing.byId.get(shown.page));
  const label = $derived.by(() => {
    if (page === undefined) return 'Page';
    if (page.title.trim() !== '') return page.title;
    if (page.url === '' || page.url === 'about:blank') return 'New page';
    try {
      return new URL(page.url).host || page.url;
    } catch {
      return page.url;
    }
  });
</script>

<Globe class="size-3.5 shrink-0" />
<FadeText text={label} />
