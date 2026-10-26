<script lang="ts">
  import type { AgentSignalNotice } from '@runlith/agent/contracts';
  import { slide } from 'svelte/transition';
  import { messageTime } from '../chatTime';
  import { clipFade } from '../clipFade';
  import { formatContextTokens } from '../contextUsage';
  import { noticeThreads, warmShare } from '../notices';
  import { useChatRendering } from '../renderers';
  import { useChatStrings } from '../strings';
  import ThreadChip from './ThreadChip.svelte';

  let { notice, at, text }: { notice: AgentSignalNotice; at: string | undefined; text: string } = $props();

  const rendering = useChatRendering();
  const strings = useChatStrings();
  let now = $state(Date.now());
  let open = $state(false);

  const threads = $derived(noticeThreads([notice], rendering.threadName));
  const share = $derived(notice.kind === 'child-update' ? warmShare(notice, at, now) : null);
  const readable = $derived((notice.kind !== 'child-update' || notice.event === 'tasks') && text.trim().length > 0);

  $effect(() => {
    if (notice.kind !== 'child-update' || notice.cost.kind !== 'warm') return;
    const until = Date.parse(notice.cost.until);
    now = Date.now();
    const timer = setInterval(() => {
      now = Date.now();
      if (now >= until) clearInterval(timer);
    }, 30_000);
    return () => clearInterval(timer);
  });

  function keyed(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    open = !open;
  }
</script>

{#snippet line()}
  {#each threads as thread (thread.id)}
    <ThreadChip {thread} />
  {/each}
  <span class="min-w-0 flex-1 whitespace-nowrap text-foreground" data-fade {@attach clipFade}
    >{notice.kind === 'child-update'
      ? strings.childUpdate(notice)
      : notice.kind === 'thread-event'
        ? strings.threadEvent(notice)
        : strings.callEnding(notice)}{#if at !== undefined}<span class="text-muted-foreground">
        · {messageTime(at, strings.locale)}</span
      >{/if}{#if (notice.kind === 'child-update' || notice.kind === 'thread-event') && notice.forOperator}<span
        class="ml-1.5 rounded-full bg-selected px-1.5 text-meta text-foreground">{strings.yourWords()}</span
      >{/if}</span
  >
  {#if notice.kind === 'child-update'}
    {@const cost = notice.cost}
    {#if cost.tokens !== null}
      <span class="shrink-0 whitespace-nowrap">{strings.childContext(formatContextTokens(cost.tokens, strings.locale))}</span>
    {/if}
    {#if cost.kind === 'warm' || cost.kind === 'cold'}
      {@const warm = cost.kind === 'warm' && share !== null && share > 0}
      <span class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span class="relative h-1 w-8 overflow-hidden rounded-full bg-border">
          {#if warm}<span class="absolute inset-y-0 left-0 rounded-full bg-chat-live" style:width={`${(share ?? 0) * 100}%`}></span>{/if}
        </span>
        {cost.kind === 'warm' && warm ? strings.warmTill(messageTime(cost.until, strings.locale)) : strings.childCache('cold')}
      </span>
    {:else if cost.kind !== 'unknown'}
      <span class="shrink-0 whitespace-nowrap">{strings.childCache(cost.kind)}</span>
    {/if}
  {/if}
{/snippet}

<div class={['grid rounded-md', open ? 'bg-hover' : 'hover:bg-hover']}>
  {#if readable}
    <div
      role="button"
      tabindex="0"
      aria-expanded={open}
      class="flex h-8 min-w-0 cursor-pointer items-center gap-3 px-2 text-ui tabular-nums text-muted-foreground"
      onclick={() => (open = !open)}
      onkeydown={keyed}
    >
      {@render line()}
    </div>
  {:else}
    <div class="flex h-8 min-w-0 items-center gap-3 px-2 text-ui tabular-nums text-muted-foreground">{@render line()}</div>
  {/if}
  {#if open}
    <div class="min-w-0 px-2 pb-2 text-small whitespace-pre-wrap break-words text-muted-foreground" transition:slide={{ duration: 160 }}>
      {text}
    </div>
  {/if}
</div>
