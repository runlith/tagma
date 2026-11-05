<script lang="ts">
  import type { ToolDisplayItem } from '@runlith/agent/tool/display';
  import { inStep } from '../inStep';
  import { useChatRendering } from '../renderers';
  import { ANSWER_LINES } from '../rowEstimate';
  import { useChatStrings } from '../strings';
  import Clamp from './Clamp.svelte';

  let { id, items }: { id: string; items: readonly ToolDisplayItem[] } = $props();

  const rendering = useChatRendering();
  const strings = useChatStrings();

  const MARK = {
    working: 'animate-breathe bg-chat-live-mark',
    answered: 'bg-chat-success-mark',
    partial: 'bg-chat-interrupted',
    failed: 'bg-chat-failure',
  } as const;
</script>

{#snippet question(item: ToolDisplayItem)}
  {@const state = item.state ?? 'answered'}
  {#key state}
    <span class="mt-1.5 size-2 shrink-0 {MARK[state]}" aria-hidden="true" {@attach state === 'working' ? inStep : undefined}></span>
  {/key}
  <span class="min-w-0 break-words">{item.label}</span>
{/snippet}

<ul class="grid min-w-0 gap-2">
  {#each items as item, index (index)}
    <li class="grid min-w-0 gap-1">
      {#if item.thread}
        {@const thread = item.thread}
        <button
          type="button"
          class="-mx-1.5 flex min-w-0 cursor-pointer items-start gap-2 rounded-md px-1.5 py-0.5 text-left text-ui leading-5 text-foreground/90 hover:bg-hover"
          aria-label={`${strings.openThread()}: ${item.label}`}
          {@attach rendering.navigation.link({ kind: 'thread', threadId: thread.id, projectId: thread.projectId })}
        >
          {@render question(item)}
        </button>
      {:else}
        <div class="flex min-w-0 items-start gap-2 py-0.5 text-ui leading-5 text-foreground/90">
          {@render question(item)}
        </div>
      {/if}
      {#if item.detail}
        <div class="min-w-0 pl-4">
          <Clamp id={`${id}:${index}`} lines={ANSWER_LINES} class="leading-5">
            {@render rendering.markdown({ cacheKey: `${id}:${index}`, size: 'small', class: 'text-muted-foreground', text: item.detail })}
          </Clamp>
        </div>
      {/if}
    </li>
  {/each}
</ul>
