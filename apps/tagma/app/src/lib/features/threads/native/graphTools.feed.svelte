<script lang="ts">
  import { operationsOwnedBy } from '@tagma/server/composition/catalog';
  import type { GraphToolAnswer } from '@tagma/server/graph/contract/wire/toolAnswers';
  import { graphText } from '@tagma/server/graph/voice/answers';
  import { settingsText } from '@tagma/server/settings/voice';
  import { mcpText } from '@tagma/server/mcp/voice';
  import { performanceAnswerText } from '@tagma/server/performance/voice';
  import type { ChatEntryOf, ChatMarkdownBody } from '@runlith/chat-ui/renderers';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { SessionNaming } from '$lib/wire/SessionNaming.svelte.js';
  import ChatMarkdown from './ChatMarkdown.svelte';
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import ToolResultRow from './ToolResultRow.svelte';

  let { kinds, contributor }: { kinds: EntryKinds; contributor: string } = $props();

  const tags = TagCatalog.use();
  const naming = SessionNaming.use();

  const voiced = (names: readonly string[], modelText: (output: unknown) => string | null, render?: typeof nativeToolRow) =>
    names.map((name) => kinds.registerTool(contributor, { name, modelText, render }));

  $effect.pre(() => {
    const disposers = [
      ...voiced(
        [...operationsOwnedBy('graph'), ...operationsOwnedBy('reflections')],
        (output) => graphText(tags.table, output as GraphToolAnswer, naming.identity),
        nativeToolRow,
      ),
      ...voiced(operationsOwnedBy('performance'), performanceAnswerText, nativeToolRow),
      ...voiced(operationsOwnedBy('settings'), (output) => settingsText(output, naming.identity)),
      ...voiced(operationsOwnedBy('mcp'), mcpText),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  });
</script>

{#snippet nativeToolRow(entry: ChatEntryOf<'tool'>)}
  <ToolResultRow {entry} {markdown} />
{/snippet}

{#snippet markdown(body: ChatMarkdownBody)}
  <ChatMarkdown {body} />
{/snippet}
