<script lang="ts" module>
  import { productEntry, productId } from '@runlith/chat-ui/entries';
  import { productKind } from '@runlith/chat-ui/EntryKinds.svelte';

  export type Probe = { readonly label: string };

  export const probeId = productId<Probe>('probe');
  export const probeKind = productKind(probeId);
  export const probeEntry = (label: string) => productEntry(probeId, { id: `probe:${label}` }, { label });
</script>

<script lang="ts">
  import type { ChatEntryContext, ChatEntryOf } from '@runlith/chat-ui/renderers';
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import type { FeedRegions } from '@runlith/chat-ui/FeedRegions.svelte';

  let { kinds, regions, contributor }: { kinds: EntryKinds; regions: FeedRegions; contributor: string } = $props();

  $effect.pre(() => {
    const disposers = [
      kinds.register(contributor, { ...probeKind, keepAlive: true }),
      kinds.registerTool(contributor, { name: 'probe_tool', render: probeTool }),
      regions.pin(contributor, { id: 'probe', body: probePin }),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  });
</script>

{#snippet probeTool(_entry: ChatEntryOf<'tool'>)}
  <span>tool</span>
{/snippet}

{#snippet probePin(_view: ChatEntryContext)}
  <span>pinned</span>
{/snippet}
