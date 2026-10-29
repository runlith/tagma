<script lang="ts">
  import type { FeedRegions } from '@runlith/chat-ui/FeedRegions.svelte';
  import type { ChatEntryContext } from '@runlith/chat-ui/renderers';
  import type { ChatPinBounds } from '@runlith/chat-ui/surface';
  import TagmaAppView from '../../tagma-apps/TagmaAppView.svelte';
  import type { ShownThread } from '../ShownThread.js';
  import { ThreadFeed } from '../thread/ThreadFeed.svelte.js';

  let { shown, regions, contributor }: { shown: ShownThread; regions: FeedRegions; contributor: string } = $props();

  const pins = $derived(shown.lease?.get(ThreadFeed).chatThread?.pins ?? []);

  const pinning = $derived(pins.length > 0);

  $effect.pre(() => {
    if (!pinning) return;
    return regions.pin(contributor, { id: 'thread-views', body: pinnedViews });
  });
</script>

{#snippet pinnedViews(_context: ChatEntryContext, bounds: ChatPinBounds)}
  {#each pins as pin (JSON.stringify([pin.app, pin.view, pin.key]))}
    <section class="border-b border-border" data-tagma-app={pin.app} data-view={pin.view} data-resource-key={pin.key}>
      <TagmaAppView
        tagmaApp={pin.app}
        view={pin.view}
        projectId={shown.projectId}
        threadId={shown.id}
        key={pin.key}
        ceiling={bounds.maxHeight}
      />
    </section>
  {/each}
{/snippet}
