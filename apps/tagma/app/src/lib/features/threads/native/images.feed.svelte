<script lang="ts">
  import { IMAGE_OPERATIONS } from '@tagma/server/images/contract/wire/operations';
  import type { ChatAttachment } from '@runlith/chat-ui/entries';
  import AttachmentStrip from '@runlith/chat-ui/entries/AttachmentStrip.svelte';
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import type { ChatEntryContext, ChatEntryOf } from '@runlith/chat-ui/renderers';

  let { kinds, contributor }: { kinds: EntryKinds; contributor: string } = $props();

  $effect.pre(() => kinds.registerTool(contributor, { name: IMAGE_OPERATIONS.generate_image.id, view: drawn }));

  const pictures = (entry: ChatEntryOf<'tool'>): readonly ChatAttachment[] =>
    (entry.display?.images ?? []).map((image) => ({ mime: image.mediaType, url: image.url, filename: image.label }));
</script>

{#snippet drawn(entry: ChatEntryOf<'tool'>, context: ChatEntryContext)}
  {@const shown = pictures(entry)}
  {#if shown.length > 0}
    <AttachmentStrip entryId={entry.id} attachments={shown} {context} align="start" size="full" />
  {/if}
{/snippet}
