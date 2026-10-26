<script lang="ts">
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import type { ChatEntryOf } from '@runlith/chat-ui/renderers';
  import AppView from '../../mcp/AppView.svelte';
  import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
  import type { ShownThread } from '../ShownThread.js';

  let { shown, kinds, contributor }: { shown: ShownThread; kinds: EntryKinds; contributor: string } = $props();

  const server = ServerOrigin.use();

  $effect.pre(() => {
    if (server.sandbox === null) return;
    return kinds.register(contributor, { kind: 'tool', view: (entry) => (entry.display?.app === undefined ? undefined : appView) });
  });
</script>

{#snippet appView(entry: ChatEntryOf<'tool'>)}
  <AppView {entry} projectId={shown.projectId} threadId={shown.id} />
{/snippet}
