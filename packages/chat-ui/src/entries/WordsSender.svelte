<script lang="ts">
  import { clipFade } from '../clipFade';
  import type { ChatWordsSender } from '../entries';
  import { useChatRendering } from '../renderers';
  import { useChatStrings } from '../strings';

  let { sender, intent }: { sender: ChatWordsSender; intent: string | null } = $props();

  const rendering = useChatRendering();
  const strings = useChatStrings();
  const lead = $derived(intent === null ? null : strings.wordsFrom(intent));
  const name = $derived((sender.threadId === undefined ? null : rendering.threadName?.(sender.threadId, sender.projectId)) ?? sender.name);
</script>

<span class="inline-flex min-w-0 items-baseline gap-1">
  {#if lead !== null}<span class="shrink-0">{lead}</span>{/if}
  {#if sender.threadId !== undefined}
    {@const threadId = sender.threadId}
    <button
      type="button"
      class="min-w-0 cursor-pointer font-medium text-foreground/80 underline-offset-2 hover:underline"
      data-fade
      {@attach clipFade}
      {@attach rendering.navigation.link({ kind: 'thread', threadId, projectId: sender.projectId })}
    >
      {name}
    </button>
  {:else}
    <span class="min-w-0 font-medium text-foreground/80" data-fade {@attach clipFade}>{name}</span>
  {/if}
</span>
