<script lang="ts">
  import type { ToolActivityEntry } from '@runlith/chat-ui/activity';
  import { useChatRendering } from '@runlith/chat-ui/renderers';
  import { toolSettled } from '@runlith/chat-ui/activity';
  import type { Tool, ToolFace } from '@runlith/tagma/plugin';
  import { toolValueOf } from '@runlith/tagma/plugin/value';
  import { untrack } from 'svelte';
  import PluginView from '../../plugin-views/PluginView.svelte';
  import { toolStateOf } from '../../plugin-views/transcript.js';

  type Props = { entry: ToolActivityEntry; plugin: string; view: string; tool: string; projectId: number; threadId: string };

  let { entry, plugin, view, tool, projectId, threadId }: Props = $props();

  const rendering = useChatRendering();

  const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  const valueOf = (output: unknown): unknown => {
    if (typeof output === 'string') return toolValueOf(output);
    if (isRecord(output) && typeof output.text === 'string') return toolValueOf(output.text, output.structuredContent);
    return undefined;
  };

  const face = $derived({
    name: tool,
    input: entry.toolInput ?? {},
    output: toolSettled(entry) ? valueOf(entry.toolOutput) : undefined,
    state: toolStateOf(entry.toolState),
    threadId,
  } satisfies ToolFace<{ readonly tools: Readonly<Record<string, Tool>> }, string>);

  $effect(() => {
    if (toolSettled(entry) && entry.truncated !== undefined) untrack(() => rendering.loadEntry(entry.id));
  });
</script>

<div class="rounded-lg border border-border">
  <PluginView {plugin} {view} {projectId} {threadId} props={face} />
</div>
