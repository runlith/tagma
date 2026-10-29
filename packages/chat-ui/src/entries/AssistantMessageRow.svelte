<script lang="ts">
  import type { ChatEntryContext, ChatEntryOf } from '../renderers';
  import { useChatRendering } from '../renderers';
  import MessageMeta from './MessageMeta.svelte';

  type Props = {
    entry: ChatEntryOf<'assistant'>;
    context: ChatEntryContext;
  };

  let { entry, context }: Props = $props();
  const rendering = useChatRendering();
  const markdown = rendering.markdown;
  const extra = $derived(rendering.kinds.messageMeta(entry));
</script>

<article class="group/msg relative mr-auto w-full min-w-0 max-w-feed text-foreground has-[[open]]:z-[130]">
  {#if entry.text}
    {@render markdown({
      cacheKey: entry.id,
      streaming: entry.assistantState === 'streaming',
      text: entry.text,
    })}
  {/if}
  <MessageMeta
    align="start"
    copied={context.copied(entry.id)}
    occurredAt={entry.occurredAt}
    onCopy={entry.text ? () => context.copy(entry.id, entry.text) : undefined}
    {extra}
  />
</article>
