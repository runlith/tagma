<script lang="ts">
  import type { Snippet } from 'svelte';
  import { type ChatEntryContext, type ChatEntryOf, useChatRendering } from '../renderers';
  import { useChatStrings } from '../strings';
  import AttachmentStrip from './AttachmentStrip.svelte';
  import CollapsibleText from './CollapsibleText.svelte';
  import MessageMeta from './MessageMeta.svelte';
  import UserMessageActions from './UserMessageActions.svelte';
  import WordsSender from './WordsSender.svelte';

  let { entry, context, textContent }: { entry: ChatEntryOf<'words'>; context: ChatEntryContext; textContent?: Snippet<[string]> } =
    $props();

  const strings = useChatStrings();
  const rendering = useChatRendering();
  const rewind = $derived(entry.opensTurn && entry.rewound === undefined && rendering.opensRun(entry.id) ? rendering.rewind : undefined);
</script>

<article data-message-id={entry.id} class="group/msg ml-auto flex min-w-0 max-w-[min(85%,72ch)] flex-col items-end">
  {#if entry.sender !== null}
    <p class="flex min-w-0 max-w-full pb-1 text-small text-muted-foreground">
      <WordsSender sender={entry.sender} intent={entry.intent} />
    </p>
  {/if}
  {#if entry.attachments && entry.attachments.length > 0}
    <AttachmentStrip entryId={entry.id} attachments={entry.attachments} {context} />
  {/if}
  {#if entry.text}
    <div class="min-w-0 max-w-full overflow-hidden rounded-lg rounded-br-sm bg-chat-raised px-4 py-2 text-foreground">
      <CollapsibleText
        text={entry.text}
        textClass={entry.sender === null ? 'whitespace-pre-wrap text-body leading-6' : 'min-w-0'}
        expanded={context.expanded(entry.id)}
        onToggle={() => context.setExpanded(entry.id, !context.expanded(entry.id))}
        content={entry.sender === null ? textContent : authored}
      />
    </div>
  {/if}
  {#if entry.unconfirmed}
    <p class="mt-1 text-meta text-muted-foreground">{strings.wordsUnconfirmed()}</p>
  {/if}
  <MessageMeta
    align="end"
    copied={context.copied(entry.id)}
    occurredAt={entry.occurredAt}
    onCopy={entry.text ? () => context.copy(entry.id, entry.text) : undefined}
    actions={rewind === undefined || entry.runId === undefined ? undefined : actions}
  />
</article>

{#snippet authored(text: string)}
  {@render rendering.markdown({ cacheKey: entry.id, text, onRendered: () => context.contentRendered(entry.id) })}
{/snippet}

{#snippet actions()}
  {#if rewind !== undefined && entry.runId !== undefined}
    <UserMessageActions runId={entry.runId} {rewind} />
  {/if}
{/snippet}
