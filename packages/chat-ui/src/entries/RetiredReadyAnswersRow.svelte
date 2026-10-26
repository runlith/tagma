<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { slide } from 'svelte/transition';
  import { messageTime } from '../chatTime';
  import type { ChatEntryContext, ChatEntryOf } from '../renderers';
  import { useChatStrings } from '../strings';

  type Props = {
    entry: ChatEntryOf<'ready-answers'>;
    context: ChatEntryContext;
  };

  let { entry, context }: Props = $props();
  const strings = useChatStrings();

  const open = $derived(context.expanded(entry.id));
  const picked = $derived(context.readyAnswerPick(entry.id));
</script>

<div class="mr-auto w-full min-w-0 max-w-feed">
  <button
    type="button"
    class="flex max-w-full cursor-pointer items-center gap-1.5 text-small text-muted-foreground/70 transition hover:text-muted-foreground"
    aria-expanded={open}
    onclick={() => context.setExpanded(entry.id, !open)}
  >
    <ChevronRight class={`size-3 shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
    <span class="shrink-0">{strings.quickReplies()}</span>
    <span class="min-w-0 truncate text-muted-foreground/50">
      · {picked === undefined ? strings.repliedInChat() : entry.answers[picked]?.label}
    </span>
    {#if entry.occurredAt}<span class="shrink-0 text-muted-foreground/50">{messageTime(entry.occurredAt, strings.locale)}</span>{/if}
  </button>
  {#if open}
    <div transition:slide={{ duration: 160 }} class="mt-2 flex flex-wrap gap-1.5 pl-5">
      {#each entry.answers as answer, index (`${entry.id}:${index}`)}
        <span
          class={[
            'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-small',
            index === picked ? 'border-chat-success/40 text-foreground' : 'border-border/60 text-muted-foreground',
          ]}
        >
          {#if index === picked}<Check class="size-3 text-chat-success-mark" />{/if}
          {answer.label}
        </span>
      {/each}
    </div>
  {/if}
</div>
