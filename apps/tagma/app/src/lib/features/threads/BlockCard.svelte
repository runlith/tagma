<script lang="ts">
  import type { Tagged } from '@tagma/server/graph/contract/wire/tags/roles';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import TagIcon from '$lib/features/graph/TagIcon.svelte';
  import { type BlockPlace, type BlockRefView, blockRefView } from '$lib/features/graph/blockRefView.js';
  import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
  import { blockLink } from '$lib/features/graph/links.js';
  import { statusLabel, statusText } from '$lib/features/graph/status.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import type { GraphAim } from '$lib/features/workspace/GraphRung.js';
  import FadeText from '$lib/shared/FadeText.svelte';

  const tags = TagCatalog.use();
  const titles = BlockTitles.use();
  const addresses = Addresses.use();
  const opening = Opening.use();
  const here = App.current();

  type ToolBlockRow = Tagged & {
    readonly name: string;
    readonly title: string;
  };

  let { block, diff, place }: { block: ToolBlockRow; diff?: string; place?: BlockPlace } = $props();

  const status = $derived(tags.statusOf(block));
  const placed = $derived(place === undefined ? null : titles.placed(block.name, place, diff));
  const view = $derived<BlockRefView>(
    placed === null
      ? blockRefView(addresses, block.name, null, titles.peer(block.name), diff)
      : { text: block.title, title: null, dead: false, href: placed ?? null },
  );
  const copy = $derived<GraphAim | undefined>(
    place === undefined
      ? undefined
      : place.branch !== undefined
        ? { projectId: place.projectId, branch: place.branch }
        : place.checkout === null
          ? { projectId: place.projectId, branch: null }
          : undefined,
  );
</script>

<a
  href={view.href}
  role={view.href === null ? 'link' : undefined}
  tabindex={view.href === null ? 0 : undefined}
  {@attach linkTarget(opening, () => blockLink({ name: block.name, copy, diff }), here)}
  class="group/card flex min-w-0 items-center gap-2 rounded-lg border bg-raised/60 px-3 py-1.5 text-ui transition-colors hover:border-input"
>
  <TagIcon tag={tags.tagOf(block)} class="size-3.5 shrink-0 text-muted-foreground" />
  <FadeText class="min-w-0 flex-1" text={block.title} />
  {#if status !== null}
    <span class={['shrink-0 text-small', statusText(status)]}>{statusLabel(status)}</span>
  {/if}
</a>
