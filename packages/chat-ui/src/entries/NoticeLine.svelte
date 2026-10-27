<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { AgentSignalNotice } from '@runlith/agent/contracts';
  import { slide } from 'svelte/transition';
  import { messageTime } from '../chatTime';
  import { clipFade } from '../clipFade';
  import { formatContextTokens } from '../contextUsage';
  import { noticeThreads, warmShare } from '../notices';
  import { useChatRendering } from '../renderers';
  import { useChatStrings } from '../strings';
  import ThreadChip from './ThreadChip.svelte';
  import Well from './Well.svelte';

  let {
    id,
    notice,
    at,
    text,
    step = false,
  }: { id: string; notice: AgentSignalNotice; at: string | undefined; text: string; step?: boolean } = $props();

  const rendering = useChatRendering();
  const strings = useChatStrings();
  const context = $derived(rendering.context);
  let now = $state(Date.now());

  const openKey = $derived(`${id}:notice`);
  const open = $derived(context.expanded(openKey));
  const threads = $derived(noticeThreads([notice], rendering.threadName));
  const share = $derived(notice.kind === 'child-update' ? warmShare(notice, at, now) : null);
  const subject = $derived(notice.kind === 'command-ending' ? (notice.label ?? notice.command) : null);
  const readable = $derived(
    notice.kind === 'command-ending' || ((notice.kind !== 'child-update' || notice.event === 'tasks') && text.trim().length > 0),
  );

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

  const lineClass = $derived([
    'flex min-w-0 gap-x-2 overflow-hidden text-ui whitespace-nowrap tabular-nums',
    step ? 'items-baseline leading-5' : 'h-8 items-center px-2',
  ]);

  function toggle(): void {
    context.setExpanded(openKey, !open);
  }

  function keyed(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    toggle();
  }

  function words(shown: AgentSignalNotice): string {
    switch (shown.kind) {
      case 'child-update':
        return strings.childUpdate(shown);
      case 'thread-event':
        return strings.threadEvent(shown);
      case 'call-ending':
        return strings.callEnding(shown);
      case 'command-ending':
        return strings.commandEnding(shown);
    }
  }
</script>

{#snippet line()}
  {#each threads as thread (thread.id)}
    <ThreadChip {thread} />
  {/each}
  <span class={['min-w-0', step ? 'text-muted-foreground' : 'text-foreground']} data-fade {@attach clipFade}
    >{words(notice)}{#if subject !== null}<span class={['ml-2', step ? 'text-foreground/80' : 'text-muted-foreground']}>{subject}</span
      >{/if}</span
  >
  {#if (notice.kind === 'child-update' || notice.kind === 'thread-event') && notice.forOperator}
    <span class="shrink-0 rounded-sm bg-selected px-1.5 text-meta text-foreground">{strings.yourWords()}</span>
  {/if}
  {#if notice.kind === 'command-ending' && notice.exit !== null}
    <span class="shrink-0 font-mono text-meta text-muted-foreground/60">{strings.commandExit(notice.exit)}</span>
  {/if}
  {#if notice.kind === 'child-update'}
    {@const cost = notice.cost}
    {#if cost.tokens !== null}
      <span class="shrink-0 whitespace-nowrap text-small text-muted-foreground/70"
        >{strings.childContext(formatContextTokens(cost.tokens, strings.locale))}</span
      >
    {/if}
    {#if cost.kind === 'warm' || cost.kind === 'cold'}
      {@const warm = cost.kind === 'warm' && share !== null && share > 0}
      <span class="inline-flex shrink-0 items-center gap-1.5 self-center whitespace-nowrap text-small text-muted-foreground/70">
        <span class="relative h-1 w-8 overflow-hidden bg-border">
          {#if warm}<span class="absolute inset-y-0 left-0 bg-chat-live" style:width={`${(share ?? 0) * 100}%`}></span>{/if}
        </span>
        {cost.kind === 'warm' && warm ? strings.warmTill(messageTime(cost.until, strings.locale)) : strings.childCache('cold')}
      </span>
    {:else if cost.kind !== 'unknown'}
      <span class="shrink-0 whitespace-nowrap text-small text-muted-foreground/70">{strings.childCache(cost.kind)}</span>
    {/if}
  {/if}
  {#if at !== undefined}
    <span class="shrink-0 font-mono text-meta tabular-nums text-muted-foreground/60">{messageTime(at, strings.locale)}</span>
  {/if}
  {#if readable}
    <ChevronRight class={['size-3 shrink-0 self-center text-muted-foreground/40 transition-transform', open && 'rotate-90']} />
  {/if}
{/snippet}

{#snippet body()}
  {#if notice.kind === 'command-ending'}
    {@const printed = notice.tail !== null && notice.tail.trim() !== '' ? notice.tail : null}
    {#if notice.command !== null || printed !== null}
      <Well
        {id}
        copy={[notice.command, printed].filter((part) => part !== null).join('\n')}
        count={printed === null ? null : strings.lineCount(printed.split('\n').length)}
      >
        {#if notice.command !== null}
          <pre
            class="min-w-0 font-mono text-small leading-5 whitespace-pre-wrap break-words text-foreground select-text">{notice.command}</pre>
        {/if}
        {#if printed !== null}
          <pre
            class={[
              'min-w-0 font-mono text-small leading-5 whitespace-pre-wrap break-words text-muted-foreground select-text',
              notice.command !== null && 'mt-1',
            ]}>{printed}</pre>
        {/if}
      </Well>
    {/if}
    {#if printed === null}
      <p class="text-small text-muted-foreground">{notice.tail === null ? strings.outputUnread() : strings.noOutput()}</p>
    {/if}
  {:else}
    <Well {id} text={text.trim()} />
  {/if}
{/snippet}

<div class={['grid min-w-0', !step && ['rounded-md', open ? 'bg-hover' : readable && 'hover:bg-hover']]}>
  {#if readable}
    <div role="button" tabindex="0" aria-expanded={open} class={[lineClass, 'cursor-pointer']} onclick={toggle} onkeydown={keyed}>
      {@render line()}
    </div>
  {:else}
    <div class={lineClass}>{@render line()}</div>
  {/if}
  {#if open && readable}
    <div class={['grid min-w-0 gap-2', step ? 'mt-1.5 mb-1' : 'px-2 pb-2']} transition:slide={{ duration: 160 }}>{@render body()}</div>
  {/if}
</div>
