<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import type { Notification } from '@tagma/server/notify/contract/wire/notification';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { timeCompact } from '$lib/shared/time.js';
  import { cn } from '$lib/shared/utils.js';
  import { Attention } from './Attention.svelte.js';

  let { row, touch = false }: { row: Notification; touch?: boolean } = $props();

  const attention = Attention.use();
  const clock = WallClock.use();
  const opening = Opening.use();
  const here = App.current();

  let typed = $state('');

  const question = $derived(row.question);
  const link = $derived(row.link !== null && opening.knows(row.link) ? row.link : null);
  const reply = $derived(attention.noticeReplyOf(row));
  const busy = $derived(reply?.state === 'sending');
  const sender = $derived(row.sender.replace(/^app:/, ''));
  const floating = $derived(!touch && question === null);

  const choice = $derived(cn('rounded-full font-medium disabled:opacity-60', touch ? 'min-h-9 px-4 text-ui' : 'h-6 px-2 text-small'));

  function send(): void {
    const value = typed.trim();
    if (value !== '') void attention.answerNotice(row, value);
  }
</script>

<div
  class={cn(
    'group/row relative grid gap-2 rounded-md transition-colors',
    touch ? 'gap-3 rounded-lg border bg-raised px-4 py-3' : 'px-2 py-1.5',
    touch && question !== null && 'border-status-open/30',
    !touch && link !== null && 'hover:bg-hover',
  )}
  data-notification-row={row.id}
  data-notification-kind={question === null ? 'notice' : 'question'}
>
  {#snippet said()}
    <span class={cn('mt-1.5 size-1.5 shrink-0', question === null ? 'bg-status-done' : 'bg-status-open')}></span>
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <div class="flex items-baseline gap-2">
        <FadeText class={cn('flex-1 font-medium', touch ? 'text-body' : 'text-ui')} text={row.title} />
        <span
          class={cn(
            'shrink-0 tabular text-meta text-muted-foreground transition-opacity',
            floating && 'group-focus-within/row:opacity-0 group-hover/row:opacity-0',
          )}
        >
          {timeCompact(row.at, clock.now)}
        </span>
      </div>
      <span class="text-small text-muted-foreground">{sender}</span>
      {#if row.body !== ''}<p class={cn('text-ui', touch ? 'line-clamp-4' : 'line-clamp-3')}>{row.body}</p>{/if}
      {#if question !== null}<p class={cn(touch ? 'text-body' : 'text-ui', 'font-medium')}>{question.text}</p>{/if}
    </div>
  {/snippet}
  <div class="flex min-w-0 items-start gap-2">
    {#if link !== null}
      <div
        role="link"
        tabindex="0"
        class={cn('flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-md select-none', !touch && '-mx-2 -my-1.5 px-2 py-1.5')}
        {@attach linkTarget(opening, () => link, here)}
      >
        {@render said()}
      </div>
    {:else}
      <div class="flex min-w-0 flex-1 items-start gap-2">{@render said()}</div>
    {/if}
    {#if question === null}
      <button
        type="button"
        class={cn(
          'grid shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-60',
          touch
            ? 'size-11'
            : 'absolute top-1 right-1 size-6 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 focus-visible:opacity-100',
        )}
        aria-label="Dismiss"
        disabled={busy}
        onclick={() => void attention.dismissNotice(row)}
      >
        <X class="size-3.5" />
      </button>
    {/if}
  </div>
  {#if question !== null}
    <div class={cn('flex flex-wrap items-center gap-2', !touch && 'pl-4')}>
      {#each question.options as option, index (option)}
        <button
          type="button"
          class={cn(choice, index === 0 ? 'bg-primary text-primary-foreground' : 'bg-selected text-foreground')}
          disabled={busy}
          onclick={() => void attention.answerNotice(row, option)}
        >
          {option}
        </button>
      {:else}
        <form
          class="flex min-w-0 flex-1 items-center gap-2"
          onsubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <input
            class={cn(
              'min-w-0 flex-1 rounded-md border bg-sunken px-2 text-ui outline-none placeholder:text-muted-foreground focus-visible:border-ring',
              touch ? 'h-9' : 'h-6',
            )}
            placeholder="Answer"
            bind:value={typed}
            disabled={busy}
          />
          <button type="submit" class={cn(choice, 'bg-primary text-primary-foreground')} disabled={busy || typed.trim() === ''}>Send</button
          >
        </form>
      {/each}
      <button
        type="button"
        class={cn(
          'rounded-md text-muted-foreground hover:text-foreground disabled:opacity-60',
          touch ? 'min-h-9 px-2 text-ui' : 'px-1 text-small',
        )}
        disabled={busy}
        onclick={() => void attention.dismissNotice(row)}
      >
        Dismiss
      </button>
    </div>
  {/if}
  {#if reply?.state === 'refused'}
    <p class={cn('text-small text-destructive', !touch && 'pl-4')} role="alert">{reply.reason}</p>
  {/if}
</div>
