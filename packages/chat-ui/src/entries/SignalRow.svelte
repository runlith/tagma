<script lang="ts">
  import { ATTACHED_CONTEXT_SIGNAL_TYPE } from '@runlith/agent/transcript/parts';
  import { messageTime } from '../chatTime';
  import type { ChatAttachedDoc } from '../entries';
  import { type ChatEntryContext, type ChatEntryOf, useChatRendering } from '../renderers';
  import { WORDS_LINES } from '../rowEstimate';
  import { useChatStrings } from '../strings';
  import AttachedDocsRow from './AttachedDocsRow.svelte';
  import Clamp from './Clamp.svelte';
  import EntryDisclosure from './EntryDisclosure.svelte';

  type Props = {
    entry: ChatEntryOf<'signal'>;
    context: ChatEntryContext;
  };

  let { entry, context }: Props = $props();
  const strings = useChatStrings();
  const rendering = useChatRendering();

  const orphanDocs = $derived<readonly ChatAttachedDoc[]>(
    entry.attachedDocs ?? (entry.title || entry.text ? [{ title: entry.title?.trim() || strings.document(), text: entry.text }] : []),
  );
  const rawKey = $derived(`${entry.id}:raw`);
</script>

{#if entry.signalType === ATTACHED_CONTEXT_SIGNAL_TYPE}
  {#if orphanDocs.length > 0}
    <AttachedDocsRow docKey={entry.id} docs={orphanDocs} {context} />
  {/if}
{:else if context.verbose}
  <EntryDisclosure
    id={rawKey}
    label={entry.signalType}
    mono
    occurredAt={entry.occurredAt}
    text={entry.text}
    open={context.expanded(rawKey)}
    onToggle={() => context.setExpanded(rawKey, !context.expanded(rawKey))}
  />
{:else}
  <div class="mr-auto grid w-full min-w-0 max-w-feed gap-1">
    <p class="flex items-center gap-1.5 text-small text-muted-foreground/70">
      <span>{strings.fromAgent()}</span>
      {#if entry.occurredAt}<span class="text-muted-foreground/50">{messageTime(entry.occurredAt, strings.locale)}</span>{/if}
    </p>
    <Clamp id={entry.id} lines={WORDS_LINES} class="leading-5">
      {@render rendering.markdown({
        cacheKey: entry.id,
        size: 'ui',
        class: 'text-muted-foreground',
        text: entry.text,
        onRendered: () => context.contentRendered(entry.id),
      })}
    </Clamp>
  </div>
{/if}
