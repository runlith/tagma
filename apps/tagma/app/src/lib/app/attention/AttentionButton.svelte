<script lang="ts">
  import type { AttentionKind } from '@tagma/server/threads/contract/wire/attention';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { linkTarget, onLinkOpened } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { threadLink } from '$lib/features/presence/link.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { labelOf } from '$lib/features/workspace/mark.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { timeCompact } from '$lib/shared/time.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import Badge from '$lib/shared/ui/Badge.svelte';
  import { RAIL_IDLE, RAIL_ITEM } from '$lib/shared/ui/rail.js';
  import { cn } from '$lib/shared/utils.js';
  import { Attention } from './Attention.svelte.js';
  import AttentionIcon from './AttentionIcon.svelte';
  import NoticeCard from './NoticeCard.svelte';
  import { countsOf, groupsOf, readingOf, titleOf } from './rows.js';

  const attention = Attention.use();
  const workspace = Workspace.use();
  const opening = Opening.use();
  const surface = App.current();
  const clock = WallClock.use();
  const addresses = Addresses.use();

  const TONE: Record<AttentionKind, string> = {
    awaiting: 'bg-status-open',
    failed: 'bg-destructive',
    finished: 'bg-status-done',
  };

  let open = $state(false);
  let scope = $state<'all' | 'project'>('all');

  $effect(() => (open ? clock.watch() : undefined));

  const counts = $derived(attention.counts);
  const needed = $derived(counts.awaiting + counts.failed);
  const active = $derived(workspace.active);
  const shown = $derived(
    scope === 'project' && active !== null ? attention.rows.filter((row) => row.project.id === active.id) : attention.rows,
  );
  const groups = $derived(groupsOf(shown));
  const unread = $derived(attention.unreadIn(shown, attention.notified));
  const here = $derived(countsOf(attention.rows.filter((row) => row.project.id === active?.id)));
  const label = $derived(
    needed === 0 ? (counts.finished > 0 ? 'Attention, unread finished threads' : 'Attention') : `Attention, ${needed} need you`,
  );
</script>

<Popover.Root bind:open>
  <Tooltip text={needed > 0 ? `${needed} need you` : 'Attention'} side="right">
    <Popover.Trigger class={cn(RAIL_ITEM, RAIL_IDLE, needed > 0 && 'text-foreground')} aria-label={label} data-attention-button>
      <Badge count={needed} tone={counts.failed > 0 ? 'failed' : 'open'} class="top-0.5 right-0.5"><AttentionIcon class="size-4" /></Badge>
      {#if needed === 0 && counts.finished > 0}
        <span class="absolute top-1.5 right-1.5 size-1.5 bg-status-done" data-attention-dot></span>
      {/if}
    </Popover.Trigger>
  </Tooltip>
  <Popover.Content
    side="right"
    align="end"
    collisionPadding={12}
    class="w-96 gap-0 overflow-hidden p-0"
    style="max-height: min(26rem, var(--float-available-height, 100dvh));"
  >
    <div class="flex shrink-0 items-center justify-between gap-2 border-b px-2 py-1.5">
      <div class="flex items-center gap-0.5 rounded-md bg-hover p-0.5" role="radiogroup" aria-label="Projects">
        <button
          type="button"
          role="radio"
          aria-checked={scope === 'all'}
          class={cn(
            'rounded-sm px-2 py-0.5 text-small transition-colors',
            scope === 'all' ? 'bg-selected text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
          onclick={() => (scope = 'all')}
        >
          All projects
        </button>
        {#if active !== null}
          <button
            type="button"
            role="radio"
            aria-checked={scope === 'project'}
            class={cn(
              'flex max-w-32 items-center gap-1 rounded-sm px-2 py-0.5 text-small transition-colors',
              scope === 'project' ? 'bg-selected text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            onclick={() => (scope = 'project')}
          >
            <FadeText text={labelOf(active)} />
            {#if here.awaiting + here.failed > 0}<span class="tabular text-meta text-status-open">{here.awaiting + here.failed}</span>{/if}
          </button>
        {/if}
      </div>
      <Button
        size="xs"
        variant="ghost"
        disabled={unread === 0 || attention.marking}
        onclick={() => void attention.markRead(shown, attention.notified)}
      >
        Mark all read
      </Button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto p-1" {@attach onLinkOpened(() => (open = false))}>
      {#snippet heading(label: string, count: number)}
        <div class="flex items-baseline gap-1.5 px-2 pt-2 pb-1 text-meta text-muted-foreground">
          <span class="font-medium">{label}</span>
          <span class="tabular">{count}</span>
        </div>
      {/snippet}
      {#if attention.notified.length > 0}
        {@render heading('Notifications', attention.notified.length)}
        {#each attention.notified as notice (notice.id)}
          <NoticeCard row={notice} />
        {/each}
      {/if}
      {#each groups as group (group.kind)}
        {@render heading(group.label, group.rows.length)}
        {#each group.rows as row (row.threadId)}
          <a
            href={addresses.thread(row.threadId, row.project.name)}
            class="flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors select-none hover:bg-hover"
            data-attention-row={row.threadId}
            data-attention-kind={row.kind}
            {@attach linkTarget(opening, () => threadLink({ threadId: row.threadId, projectId: row.project.id }), surface)}
            onclick={() => (open = false)}
          >
            <span class={cn('mt-1.5 size-1.5 shrink-0', TONE[row.kind])}></span>
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="flex items-baseline gap-2">
                <FadeText class="flex-1 text-ui" text={titleOf(row)} />
                <span class="shrink-0 tabular text-meta text-muted-foreground">{timeCompact(row.at, clock.now)}</span>
              </span>
              <span class="flex items-baseline gap-1.5 text-small text-muted-foreground">
                <span class="shrink-0 font-medium">{row.project.name}</span>
                <FadeText class="flex-1" text={readingOf(row)} />
              </span>
            </span>
          </a>
        {/each}
      {/each}
      {#if groups.length === 0 && attention.notified.length === 0}
        <div class="px-2 py-6 text-center text-small text-muted-foreground">
          {attention.known ? 'Nothing needs you.' : attention.problem === null ? 'Reading…' : 'Not available.'}
        </div>
      {/if}
      {#if scope === 'all' && attention.hidden > 0}
        <div class="px-2 py-2 text-center text-meta text-muted-foreground">{attention.hidden} older not shown</div>
      {/if}
    </div>
    {#if attention.problem !== null}
      <div class="shrink-0 border-t px-3 py-2 text-small text-destructive">{attention.problem}</div>
    {/if}
  </Popover.Content>
</Popover.Root>
