<script lang="ts">
  import type { ToolActivityEntry } from '@runlith/chat-ui/activity';
  import { useChatRendering } from '@runlith/chat-ui/renderers';
  import { untrack } from 'svelte';
  import { toolInputNotice, toolOutcomeNotice } from './toolNotices.js';
  import type { ViewBridge, ViewDocument, ViewHost } from './ViewBridge.js';
  import ViewFrame from './ViewFrame.svelte';
  import type { ViewIdentity } from '@tagma/server/executions/contract/wire/viewName';

  type Props = {
    entry: ToolActivityEntry;
    view: ViewDocument;
    host: ViewHost;
    title: string;
    identity: ViewIdentity;
    bordered: boolean;
  };

  let { entry, view, host, title, identity, bordered }: Props = $props();

  const rendering = useChatRendering();

  const settled = $derived(toolOutcomeNotice(entry));
  const outcome = $derived(entry.truncated === undefined ? settled : null);

  let bridge = $state<ViewBridge | null>(null);
  const told = new WeakSet<ViewBridge>();

  const tell = (made: ViewBridge): void => {
    const notice = untrack(() => outcome);
    if (notice === null || told.has(made)) return;
    if (made.notify(notice.method, notice.params)) told.add(made);
  };

  const initialized = (): void => {
    const made = untrack(() => bridge);
    if (made === null) return;
    told.delete(made);
    const input = toolInputNotice(untrack(() => entry));
    made.notify(input.method, input.params);
    tell(made);
  };

  $effect(() => {
    if (outcome === null || bridge === null) return;
    tell(bridge);
  });

  $effect(() => {
    if (settled !== null && entry.truncated !== undefined) untrack(() => rendering.loadEntry(entry.id));
  });
</script>

{#key view}
  <ViewFrame {view} {host} {title} {identity} {bordered} {initialized} bind:bridge />
{/key}
