<script lang="ts">
  import type { ToolDisplayItem } from '@runlith/agent/tool/display';
  import { clipFade } from '../clipFade';
  import { useChatRendering } from '../renderers';
  import { useChatStrings } from '../strings';

  let { id, items }: { id: string; items: readonly ToolDisplayItem[] } = $props();

  const rendering = useChatRendering();
  const strings = useChatStrings();

  const MARK = {
    answered: 'bg-chat-success-mark',
    partial: 'bg-chat-interrupted',
    failed: 'bg-chat-failure',
  } as const;
</script>

<ul class="grid min-w-0 gap-2">
  {#each items as item, index (index)}
    <li class="grid min-w-0 gap-1">
      {#if item.thread}
        {@const thread = item.thread}
        <button
          type="button"
          class="flex min-w-0 cursor-pointer items-center gap-2 rounded-md text-left text-ui leading-6 text-foreground/90 hover:bg-hover"
          aria-label={`${strings.openThread()}: ${item.label}`}
          {@attach rendering.navigation.link({ kind: 'thread', threadId: thread.id, projectId: thread.projectId })}
        >
          <span class="size-2 shrink-0 {MARK[item.state ?? 'answered']}" aria-hidden="true"></span>
          <span class="min-w-0" data-fade {@attach clipFade}>{item.label}</span>
        </button>
      {:else}
        <div class="flex min-w-0 items-center gap-2 text-ui leading-6 text-foreground/90">
          <span class="size-2 shrink-0 {MARK[item.state ?? 'answered']}" aria-hidden="true"></span>
          <span class="min-w-0" data-fade {@attach clipFade}>{item.label}</span>
        </div>
      {/if}
      {#if item.detail}
        <div class="min-w-0 pl-4 leading-5">
          {@render rendering.markdown({ cacheKey: `${id}:${index}`, size: 'small', class: 'text-muted-foreground', text: item.detail })}
        </div>
      {/if}
    </li>
  {/each}
</ul>
