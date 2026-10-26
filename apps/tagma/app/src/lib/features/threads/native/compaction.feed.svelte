<script lang="ts">
  import { CountdownClock } from '$lib/features/providers/accounts/CountdownClock.svelte.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import type { ThreadDraft } from '../Draft.svelte.js';
  import type { ModelPanelState } from '../ModelPanelState.svelte.js';
  import type { ShownThread } from '../ShownThread.js';
  import { ThreadCompaction } from '../thread/ThreadCompaction.svelte.js';
  import { summarizerFacts, summarizerTitle } from './compactionWords.js';

  let {
    shown,
    draft,
    panel,
    kinds,
    contributor,
  }: { shown: ShownThread; draft: ThreadDraft; panel: ModelPanelState; kinds: EntryKinds; contributor: string } = $props();

  const catalog = ProviderCatalog.use();
  const clock = CountdownClock.use();

  $effect(() => shown.lease?.get(ThreadCompaction).watch(draft.slashOpen || panel.current?.mode === 'compact'));

  $effect.pre(() =>
    kinds.register(contributor, {
      kind: 'compaction',
      identity: (entry) => {
        const title = summarizerTitle(catalog.models, entry);
        return title === undefined ? undefined : { title, threads: [] };
      },
      facts: (entry) => summarizerFacts(catalog.models, entry, clock.now),
    }),
  );
</script>
