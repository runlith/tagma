<script lang="ts">
  import type { ChatEntryOf, ChatMarkdownBody, ChatRendering } from '@runlith/chat-ui/renderers';
  import { provideChatRendering } from '@runlith/chat-ui/renderers';
  import { provideChatStrings } from '@runlith/chat-ui/strings';
  import type { Snippet } from 'svelte';
  import { nativeStrings } from './strings.js';
  import ToolResultRow from './ToolResultRow.svelte';

  let { entry, markdown }: { entry: ChatEntryOf<'tool'>; markdown: Snippet<[ChatMarkdownBody]> } = $props();

  const open = new Set<string>();
  const view = {
    verbose: false,
    expanded: (key: string) => open.has(key),
    setExpanded: (key: string, value: boolean) => void (value ? open.add(key) : open.delete(key)),
    copied: () => false,
    copy: () => undefined,
  };

  provideChatStrings(nativeStrings());
  provideChatRendering({
    context: view,
    touch: false,
    tip: () => () => undefined,
    navigation: { files: false, link: () => () => undefined },
  } as unknown as ChatRendering);
</script>

<ToolResultRow {entry} {markdown} />
