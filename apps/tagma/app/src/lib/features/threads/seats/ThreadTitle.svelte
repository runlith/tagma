<script lang="ts">
  import MessageSquare from '@lucide/svelte/icons/message-square';
  import Swatch from '$lib/features/workspace/Swatch.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { paneThread } from './pane.js';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';

  let { pane }: { pane: SidePane } = $props();

  const names = ThreadNames.use();
  const thread = $derived(paneThread(pane.id));
  const label = $derived(
    thread.threadId === null
      ? 'New thread'
      : (names.of(thread.threadId, thread.home === null ? undefined : String(thread.home))?.label ?? 'Thread'),
  );
</script>

{#if thread.home !== null}
  <Swatch projectId={thread.home} />
{:else}
  <MessageSquare class="size-3.5 shrink-0" />
{/if}
<FadeText text={label} />
