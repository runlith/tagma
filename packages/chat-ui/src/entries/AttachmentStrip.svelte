<script lang="ts">
  import AttachmentThumb from '../AttachmentThumb.svelte';
  import FileChip from '../FileChip.svelte';
  import type { ChatAttachment } from '../entries';
  import type { ChatEntryContext } from '../renderers';
  import { useChatStrings } from '../strings';
  import DocumentAttachment from './DocumentAttachment.svelte';
  import { isThreadDocument, isThreadFile } from '@runlith/agent/transcript/attachments';

  type Props = {
    entryId: string;
    attachments: readonly ChatAttachment[];
    context: ChatEntryContext | undefined;
    align?: 'start' | 'end';
    size?: 'thumbnail' | 'full';
  };

  let { entryId, attachments, context, align = 'end', size = 'thumbnail' }: Props = $props();
  const strings = useChatStrings();
  const documents = $derived(attachments.filter((attachment) => isThreadDocument(attachment.mime)));
  const files = $derived(attachments.filter((attachment) => isThreadFile(attachment.mime)));
  const images = $derived(attachments.filter((attachment) => !isThreadDocument(attachment.mime) && !isThreadFile(attachment.mime)));
</script>

{#if documents.length > 0}
  <div class="mb-1.5 grid w-full min-w-0 gap-1">
    {#each documents as attachment, index (`${entryId}:doc:${index}`)}
      <DocumentAttachment docKey={`${entryId}:doc:${index}`} {attachment} {context} />
    {/each}
  </div>
{/if}
{#if files.length > 0}
  <div class={['flex flex-wrap gap-1.5', align === 'end' ? 'mb-1.5 justify-end' : 'justify-start']}>
    {#each files as attachment, index (`${entryId}:file:${index}`)}
      <FileChip name={attachment.filename ?? strings.attachment()} href={attachment.url === '' ? undefined : attachment.url} />
    {/each}
  </div>
{/if}
{#if images.length > 0}
  <div class={['flex flex-wrap gap-1.5', align === 'end' ? 'mb-1.5 justify-end' : 'justify-start']}>
    {#each images as attachment, index (`${entryId}:${index}`)}
      <AttachmentThumb
        {attachment}
        size={size === 'full' ? 'full' : 'feed'}
        href={attachment.url}
        onOpen={(event) => {
          if (!context || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          context.openImage(attachment);
        }}
      />
    {/each}
  </div>
{/if}
