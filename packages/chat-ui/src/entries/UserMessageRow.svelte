<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ChatAttachedDoc } from '../entries';
  import { type ChatEntryContext, type ChatEntryOf, useChatRendering } from '../renderers';
  import UnconfirmedNote from './UnconfirmedNote.svelte';
  import UserMessageActions from './UserMessageActions.svelte';
  import AttachedDocsRow from './AttachedDocsRow.svelte';
  import AttachmentStrip from './AttachmentStrip.svelte';
  import CollapsibleText from './CollapsibleText.svelte';
  import MessageMeta from './MessageMeta.svelte';

  type Props = {
    entry: ChatEntryOf<'user'>;
    context: ChatEntryContext;
    textContent?: Snippet<[string]>;
  };

  let { entry, context, textContent }: Props = $props();

  const docs = $derived(entry.attachedDocs ?? []);
  const rendering = useChatRendering();
  const rewind = $derived(
    entry.runId !== undefined && entry.rewound === undefined && rendering.opensRun(entry.id) ? rendering.rewind : undefined,
  );

  function isAutoAttachedDocText(text: string, staged: readonly ChatAttachedDoc[]): boolean {
    if (staged.length === 0) return false;
    if (staged.some((doc) => !doc.title)) return false;
    return text.trim() === staged.map((doc) => `@${doc.title}`).join(' ');
  }
</script>

{#if docs.length > 0}
  <AttachedDocsRow docKey={entry.id} {docs} {context} />
{/if}
<article data-message-id={entry.id} class="group/msg ml-auto flex min-w-0 max-w-[min(85%,72ch)] flex-col items-end">
  {#if entry.attachments && entry.attachments.length > 0}
    <AttachmentStrip entryId={entry.id} attachments={entry.attachments} {context} />
  {/if}
  {#if entry.text && !isAutoAttachedDocText(entry.text, docs)}
    <div class="min-w-0 max-w-full overflow-hidden rounded-lg rounded-br-sm bg-chat-raised px-4 py-2 text-foreground">
      <CollapsibleText
        text={entry.text}
        textClass="whitespace-pre-wrap text-body leading-6"
        expanded={context.expanded(entry.id)}
        onToggle={() => context.setExpanded(entry.id, !context.expanded(entry.id))}
        content={textContent}
      />
    </div>
  {/if}
  {#if entry.unconfirmed && entry.turnKey !== undefined}
    {@const turnKey = entry.turnKey}
    <UnconfirmedNote onResend={() => rendering.resendTurn(turnKey)} onForget={() => rendering.forgetTurn(turnKey)} />
  {/if}
  <MessageMeta
    align="end"
    copied={context.copied(entry.id)}
    occurredAt={entry.occurredAt}
    onCopy={entry.text ? () => context.copy(entry.id, entry.text) : undefined}
    actions={rewind === undefined || entry.runId === undefined ? undefined : actions}
  />
</article>

{#snippet actions()}
  {#if rewind !== undefined && entry.runId !== undefined}
    <UserMessageActions runId={entry.runId} {rewind} />
  {/if}
{/snippet}
