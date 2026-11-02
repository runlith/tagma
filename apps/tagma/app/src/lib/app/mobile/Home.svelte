<script lang="ts">
  import Bell from '@lucide/svelte/icons/bell';
  import MessageCircle from '@lucide/svelte/icons/message-circle';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';
  import type { AttentionRow } from '@tagma/server/threads/contract/wire/attention';
  import { Platform } from '@runlith/layer/Platform';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { Push } from '$lib/features/devices/Push.svelte.js';
  import { machineName } from '$lib/features/shell/machine.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import { timeCompact } from '$lib/shared/time.js';
  import { cn } from '$lib/shared/utils.js';
  import { Attention } from '../attention/Attention.svelte.js';
  import NoticeCard from '../attention/NoticeCard.svelte';
  import { readingOf, titleOf, unreadOf } from '../attention/rows.js';
  import { WireState } from '../chrome/WireState.svelte.js';
  import Tabs from './Tabs.svelte';

  const attention = Attention.use();
  const workspace = Workspace.use();
  const wire = WireState.use();
  const clock = WallClock.use();
  const push = Push.use();
  const addresses = Addresses.use();
  const machine = machineName(Platform.use().storage.local);

  $effect(() => clock.watchMinutes());

  const asks = $derived(attention.rows.filter((row) => row.kind === 'awaiting'));
  const failed = $derived(attention.rows.filter((row) => row.kind === 'failed'));
  const done = $derived(attention.rows.filter((row) => row.kind === 'finished'));
  const asking = $derived(attention.notified.filter((row) => row.question !== null));
  const telling = $derived(attention.notified.filter((row) => row.question === null));
  const needs = $derived(asks.length + failed.length + asking.length);
</script>

<svelte:head><title>Inbox</title></svelte:head>

<header class="shrink-0 bg-chrome px-4 pt-3 pb-2">
  <h1 class="text-title">Inbox</h1>
  <p class="flex items-center gap-1.5 text-small text-muted-foreground">
    <span class={cn('size-1.5 shrink-0 rounded-full', wire.live ? 'bg-status-done' : 'bg-status-none')}></span>
    {machine} · {wire.live ? 'connected' : 'not connected'}
  </p>
</header>

<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6">
  {#if push.offered}
    <div class="mx-4 mt-2 flex items-center gap-3 rounded-lg bg-raised py-1 pl-4 shadow-raised">
      <Bell class="size-4 shrink-0 text-muted-foreground" />
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-body">Get notified when an agent needs you</span>
        {#if push.problem !== null}<span class="text-small text-destructive">{push.problem}</span>{/if}
      </span>
      <button
        type="button"
        class="min-h-11 shrink-0 px-2 text-body font-medium text-primary disabled:text-muted-foreground"
        disabled={push.busy}
        onclick={() => void push.turnOn()}
      >
        {push.busy ? 'Turning on…' : 'Turn on'}
      </button>
      <button
        type="button"
        class="grid size-11 shrink-0 place-items-center text-muted-foreground active:bg-hover"
        aria-label="Not now"
        onclick={() => push.dismiss()}
      >
        <X class="size-4" />
      </button>
    </div>
  {/if}

  {#if attention.known && attention.problem !== null}
    <p class="px-4 pt-3 text-small text-destructive" role="alert">{attention.problem}</p>
  {/if}

  {#if needs > 0}
    <section class="pt-3">
      <h2 class="flex min-h-8 items-center px-4 text-small font-medium text-muted-foreground">Needs you · {needs}</h2>
      <div class="grid gap-2 px-3">
        {#each asking as notice (notice.id)}
          <NoticeCard row={notice} touch />
        {/each}
        {#each asks as row (row.threadId)}
          {@const options = row.ask?.options ?? []}
          {@const reply = attention.replyOf(row)}
          {@const busy = reply !== null && reply.state !== 'refused'}
          <div class="grid gap-3 rounded-lg border border-status-open/30 bg-raised px-4 py-3" data-attention-row={row.threadId}>
            <a href={addresses.thread(row.threadId, row.project.name)} class="grid gap-2 active:opacity-70">
              {@render who(row, 'bg-status-open')}
              <p class={cn('text-body', options.length === 0 && 'line-clamp-4')}>{row.ask?.text ?? 'Waiting for your answer'}</p>
            </a>
            <div class="flex flex-wrap items-center gap-2">
              {#each options as option, index (index)}
                <button
                  type="button"
                  class={cn(
                    'min-h-9 rounded-full px-4 text-ui font-medium disabled:opacity-60',
                    index === 0 ? 'bg-primary text-primary-foreground' : 'bg-selected text-foreground',
                  )}
                  disabled={busy}
                  onclick={() => void attention.answer(row, option)}
                >
                  {option.label}
                </button>
              {/each}
              <a
                href={addresses.thread(row.threadId, row.project.name)}
                class="flex min-h-9 items-center gap-1.5 px-1 text-ui font-medium text-status-open"
              >
                <MessageCircle class="size-3.5" />
                {options.length > 0 ? 'Reply…' : row.ask?.kind === 'confirm' ? 'Review' : 'Answer'}
              </a>
            </div>
            {#if reply?.state === 'refused'}
              <p class="text-small text-destructive" role="alert">{reply.reason}</p>
            {/if}
          </div>
        {/each}
        {#each failed as row (row.threadId)}
          <a
            href={addresses.thread(row.threadId, row.project.name)}
            class="grid gap-1.5 rounded-lg bg-raised px-4 py-3 active:bg-selected"
            data-attention-row={row.threadId}
          >
            {@render who(row, 'bg-destructive')}
            <p class="flex min-w-0 items-start gap-1.5 text-ui text-destructive">
              <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
              <span class="line-clamp-2">{readingOf(row)}</span>
            </p>
          </a>
        {/each}
      </div>
    </section>
  {/if}

  {#if telling.length > 0}
    <section class="pt-4">
      <h2 class="flex min-h-8 items-center px-4 text-small font-medium text-muted-foreground">Notifications · {telling.length}</h2>
      <div class="grid gap-2 px-3">
        {#each telling as notice (notice.id)}
          <NoticeCard row={notice} touch />
        {/each}
      </div>
    </section>
  {/if}

  {#if done.length > 0}
    <section class="pt-4">
      <div class="flex min-h-8 items-center justify-between gap-2 px-4">
        <h2 class="text-small font-medium text-muted-foreground">Done · {done.length}</h2>
        <button
          type="button"
          class="-mr-2 min-h-11 px-2 text-small font-medium text-primary disabled:text-muted-foreground"
          disabled={attention.marking || unreadOf(done).length === 0}
          onclick={() => void attention.markRead(done, [])}
        >
          Mark read
        </button>
      </div>
      {#each done as row (row.threadId)}
        <a
          href={addresses.thread(row.threadId, row.project.name)}
          class="flex min-h-12 items-start gap-3 px-4 py-3 active:bg-hover"
          data-attention-row={row.threadId}
        >
          <span class="mt-2 size-2 shrink-0 rounded-full bg-status-done"></span>
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="flex items-baseline gap-2">
              <span class="min-w-0 flex-1 truncate text-body font-medium">{titleOf(row)}</span>
              <span class="shrink-0 tabular text-small text-muted-foreground">{timeCompact(row.at, clock.now)}</span>
            </span>
            <span class="line-clamp-2 text-ui text-muted-foreground">{readingOf(row)}</span>
            <span class="text-small text-muted-foreground/70">{row.project.name}</span>
          </span>
        </a>
      {/each}
    </section>
  {/if}

  {#if needs === 0 && done.length === 0 && telling.length === 0}
    <div class="grid justify-items-center gap-1 px-8 pt-16 text-center">
      <p class="text-body">{attention.known ? 'Nothing needs you' : attention.problem === null ? 'Reading…' : attention.problem}</p>
      {#if attention.known}
        <p class="text-ui text-muted-foreground">Questions, failures and finished work from every project land here.</p>
      {/if}
    </div>
  {/if}

  {#if workspace.loaded && workspace.projects.length === 0}
    <p class="px-4 pt-6 text-body text-muted-foreground">No projects yet. Add one from Tagma on {machine}.</p>
  {/if}
</div>

<Tabs on="inbox" />

{#snippet who(row: AttentionRow, tone: string)}
  <span class="flex min-w-0 items-center gap-2">
    <span class={cn('size-2 shrink-0 rounded-full', tone)}></span>
    <span class="min-w-0 flex-1 truncate text-body font-medium">{titleOf(row)}</span>
    <span class="shrink-0 tabular text-small text-muted-foreground">{timeCompact(row.at, clock.now)}</span>
  </span>
  <span class="-mt-1 pl-4 text-small text-muted-foreground">{row.project.name}</span>
{/snippet}
