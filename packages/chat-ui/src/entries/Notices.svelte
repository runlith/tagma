<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { slide } from 'svelte/transition';
  import { clipFade } from '../clipFade';
  import { type NoticeEntry, noticeLead, noticeThreads } from '../notices';
  import Rail from '../Rail.svelte';
  import RailRow from '../RailRow.svelte';
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
  const only = $derived(entries.length === 1 ? entries[0] : undefined);

  function toggle(): void {
    context.setExpanded(key, !open);
  }

  function keyed(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    toggle();
  }
</script>

{#if only !== undefined}
  <NoticeLine id={only.id} notice={only.notice} at={only.occurredAt} text={only.text} step />
{:else}
  <div
    role="button"
    tabindex="0"
    class="group/step flex w-full min-w-0 cursor-pointer items-baseline gap-1.5 text-left text-ui whitespace-nowrap"
    aria-expanded={open}
    onclick={toggle}
    onkeydown={keyed}
  >
    <span class="flex min-w-0 gap-x-3 text-muted-foreground transition group-hover/step:text-foreground" data-fade {@attach clipFade}>
      {#each noticeLead(notices, strings) as part, index (index)}<span class="shrink-0">{part}</span>{/each}
    </span>
    <span class="flex min-w-0 shrink-[1000] gap-1" data-fade {@attach clipFade}>
      {#each noticeThreads(notices, rendering.threadName) as thread (thread.id)}
        <ThreadChip {thread} />
      {/each}
    </span>
    <ChevronRight class={['size-3 shrink-0 self-center text-muted-foreground/40 transition-transform', open && 'rotate-90']} />
  </div>
  {#if open}
    <div class="mt-1" transition:slide={{ duration: 160 }}>
      <Rail count={entries.length}>
        {#snippet children(at)}
          {#each entries as entry, index (entry.id)}
            <RailRow place={at(index)}>
              <NoticeLine id={entry.id} notice={entry.notice} at={entry.occurredAt} text={entry.text} step />
            </RailRow>
          {/each}
        {/snippet}
      </Rail>
    </div>
  {/if}
{/if}
