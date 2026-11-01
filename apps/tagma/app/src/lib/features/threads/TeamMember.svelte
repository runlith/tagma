<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { linkSelect, linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import ProjectMark from '$lib/features/workspace/ProjectMark.svelte';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { CallActivity } from './CallActivity.svelte.js';
  import ThreadLife from './Life.svelte';
  import { RowReading } from './rowReading.svelte.js';
  import { WorkLines } from './workLines.svelte.js';
  import type { ThreadTreeNode } from './forest.js';
  import { threadLink } from '$lib/features/presence/link.js';

  let { node, here }: { node: ThreadTreeNode; here: number } = $props();

  const reading = new RowReading(() => node, WallClock.use(), WorkLines.use(), ProviderCatalog.use(), CallActivity.use());
  const opening = Opening.use();
  const surface = App.current();
  const row = $derived(node.row);
  const name = $derived(row.name ?? row.agentId);
  const home = $derived(row.projectId === here ? null : row.projectId);
  const link = () => threadLink({ threadId: row.id, projectId: row.projectId });
</script>

<DropdownMenu.Item
  {@attach linkTarget(opening, link, surface)}
  closeOnSelect={false}
  onSelect={linkSelect(opening, link, surface)}
  textValue={name}
  data-team-member={row.id}
>
  {#snippet lead()}<ThreadLife thread={row} />{/snippet}
  {#snippet tail()}<span class={['text-meta tabular-nums', reading.timeTone]}>{reading.time}</span>{/snippet}
  {name}{#if home !== null}<ProjectMark projectId={home} class="ml-1.5 inline-block max-w-24 align-bottom" />{/if}
</DropdownMenu.Item>
