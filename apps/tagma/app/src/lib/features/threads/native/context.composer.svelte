<script lang="ts">
  import type { ChatContextSource, ChatContextUsageMetrics } from '@runlith/chat-ui/contextUsage';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import type { ThreadBirth } from '../birth/ThreadBirth.svelte.js';
  import { CacheWarm } from '../cacheWarm.svelte.js';
  import type { ShownThread } from '../ShownThread.js';
  import { contextLabelsOf } from '../thread/modelSettings.js';
  import { ThreadFeed } from '../thread/ThreadFeed.svelte.js';
  import ThreadHold from '$lib/features/workspace/ThreadHold.svelte';
  import { ThreadComposition } from '../thread/ThreadComposition.svelte.js';
  import { ThreadContext } from '../thread/ThreadContext.svelte.js';
  import type { RenderingPorts } from './RenderingPorts.svelte.js';
  import ContextPanel from './Panel.svelte';

  let { shown, birth, rendering, contributor }: { shown: ShownThread; birth: ThreadBirth; rendering: RenderingPorts; contributor: string } =
    $props();

  const catalog = ProviderCatalog.use();
  const threadKey = $derived(shown.identity?.id ?? null);
  const chatThread = $derived(shown.lease?.get(ThreadFeed).chatThread ?? null);
  const cacheWarm = new CacheWarm(() => chatThread?.cacheWarmth ?? null, WallClock.use());

  $effect.pre(() =>
    rendering.contributeContext(contributor, {
      labels: (source: ChatContextSource) =>
        shown.lease?.get(ThreadContext).labels(source) ?? contextLabelsOf(catalog.models, source, birth.settings.settings),
      attribution: () => shown.lease?.get(ThreadContext).attribution,
      warm: () => cacheWarm.filled,
      detail: contextDetail,
    }),
  );
</script>

{#snippet contextDetail(metrics: ChatContextUsageMetrics)}
  {#if threadKey !== null}
    {#key threadKey}
      <ThreadHold thread={threadKey}>
        <ContextPanel
          composition={shown.lease?.get(ThreadComposition).reading ?? null}
          usage={metrics}
          failure={shown.lease?.get(ThreadComposition).failure ?? null}
          warmth={chatThread?.cacheWarmth ?? null}
          onOpen={() => void shown.lease?.get(ThreadComposition).read()}
        />
      </ThreadHold>
    {/key}
  {/if}
{/snippet}
