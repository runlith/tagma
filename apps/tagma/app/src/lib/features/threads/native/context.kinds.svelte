<script lang="ts" module>
  import EntryDisclosure from '@runlith/chat-ui/entries/EntryDisclosure.svelte';
  import type { ChatEntryContext, ChatEntryOf } from '@runlith/chat-ui/renderers';
  import ChatMarkdown from './ChatMarkdown.svelte';
  import { builtinKindDeclaration, type KindDeclaration } from './contribution.js';
  import { nativeStrings } from './strings.js';

  const strings = nativeStrings(() => undefined);

  export const kinds: readonly KindDeclaration[] = [builtinKindDeclaration({ kind: 'context', render: contextRow })];
</script>

{#snippet contextRow(entry: ChatEntryOf<'context'>, view: ChatEntryContext)}
  {#snippet body()}
    <ChatMarkdown body={{ cacheKey: entry.id, size: 'small', class: 'text-muted-foreground', text: entry.text }} />
  {/snippet}
  <EntryDisclosure
    id={entry.id}
    label={strings.context()}
    occurredAt={entry.occurredAt}
    text={entry.text}
    open={view.expanded(entry.id)}
    onToggle={() => view.setExpanded(entry.id, !view.expanded(entry.id))}
    {body}
  />
{/snippet}
