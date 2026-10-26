<script lang="ts">
  import type { ThreadCacheWarmth } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
  import ContextRing from '@runlith/chat-ui/ContextRing.svelte';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { CacheWarm } from '../cacheWarm.svelte.js';
  import { warmthWords } from '../warmthWords.js';

  let {
    share,
    compacting = false,
    warmth = null,
    provider = null,
    class: className = '',
  }: {
    share: number;
    compacting?: boolean;
    warmth?: ThreadCacheWarmth | null;
    provider?: string | null;
    class?: string;
  } = $props();

  const clock = WallClock.use();
  const catalog = ProviderCatalog.use();
  const cacheWarm = new CacheWarm(() => warmth, clock);
  const cache = $derived(warmth === null ? null : warmthWords(warmth, provider === null ? '' : catalog.name(provider), () => clock.now));
  const label = $derived(
    [compacting ? 'compacting' : null, `context ${Math.round(share * 100)}%`, cache === null ? null : `cache ${cache}`]
      .filter((part): part is string => part !== null)
      .join(' · '),
  );
</script>

<ContextRing {share} {compacting} warm={cacheWarm.filled} {label} class={className} />
