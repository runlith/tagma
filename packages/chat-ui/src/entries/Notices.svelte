<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { slide } from 'svelte/transition';
  import { clipFade } from '../clipFade';
  import { type NoticeEntry, noticeLead, noticeThreads } from '../notices';
  import { useChatRendering } from '../renderers';
  import { useChatStrings } from '../strings';
  import NoticeLine from './NoticeLine.svelte';
  import ThreadChip from './ThreadChip.svelte';

  let { key, entries }: { key: string; entries: readonly NoticeEntry[] } = $props();

  const rendering = useChatRendering();
  const strings = useChatStrings();
  const context = $derived(rendering.context);
  const notices = $derived(entries.map((entry) => entry.notice));
  const open = $derived(context.expanded(key));

  function toggle(): void {
    context.setExpanded(key, !open);
  }

  function keyed(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    toggle();
  }
</script>

<div
  role="button"
  tabindex="0"
  class="group/step flex w-full min-w-0 cursor-pointer items-baseline gap-1.5 text-left text-ui whitespace-nowrap"
  aria-expanded={open}
  onclick={toggle}
  onkeydown={keyed}
>
  <span class="min-w-0 text-muted-foreground transition group-hover/step:text-foreground" data-fade {@attach clipFade}
    >{noticeLead(notices, strings)}</span
  >
  <span class="flex min-w-0 gap-1" data-fade {@attach clipFade}>
    {#each noticeThreads(notices, rendering.threadName) as thread (thread.id)}
      <ThreadChip {thread} />
    {/each}
  </span>
  <ChevronRight class={['size-3 shrink-0 self-center text-muted-foreground/40 transition-transform', open && 'rotate-90']} />
</div>
{#if open}
  <div class="mt-1 mb-1 grid gap-px rounded-lg border border-border bg-raised p-1" transition:slide={{ duration: 160 }}>
    {#each entries as entry (entry.id)}
      <NoticeLine notice={entry.notice} at={entry.occurredAt} text={entry.text} />
    {/each}
  </div>
{/if}
