<script lang="ts">
  import Copy from '@lucide/svelte/icons/copy';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import GitCompare from '@lucide/svelte/icons/git-compare';
  import GitMerge from '@lucide/svelte/icons/git-merge';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import type { WorktreePlace, WorktreeRow } from '@tagma/server/worktrees/contract/wire/rows';
  import { Router } from '@runlith/layer/Router';
  import { untrack } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import { ContextAim } from '$lib/shared/contextAim.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
  import { timeCompact } from '$lib/shared/time.js';
  import AgentCounts from '$lib/shared/ui/AgentCounts.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import ActLine from './ActLine.svelte';
  import { phraseOf } from './board.js';
  import FinishItems from './FinishItems.svelte';
  import { Finishing } from './Finishing.svelte.js';
  import { fadeOut } from './leave.js';
  import OutcomeLine from './OutcomeLine.svelte';
  import { stepOf } from './step.js';
  import WorktreeSwatch from './WorktreeSwatch.svelte';

  let {
    row,
    facts,
    observe,
    here = false,
    onMenu,
  }: {
    row: WorktreePlace;
    facts: WorktreeRow | null;
    observe: Attachment<HTMLElement>;
    here?: boolean;
    onMenu: (open: boolean) => void;
  } = $props();

  const finishing = Finishing.use();
  const router = Router.use();
  const addresses = Addresses.use();
  const clock = WallClock.use();
  const names = ThreadNames.use();
  const aim = new ContextAim();

  let menuOpen = $state(false);
  const open = $derived(menuOpen || aim.anchor !== null);

  $effect(() => {
    if (!open) return;
    untrack(() => onMenu(true));
    return () => untrack(() => onMenu(false));
  });

  function setOpen(next: boolean): void {
    menuOpen = next;
    if (!next) aim.clear();
  }

  const main = $derived(row.kind === 'main');
  const label = $derived(row.branch ?? row.name);
  const href = $derived(row.missing || (!main && row.branch === null) ? null : addresses.git('tree', main ? null : row.branch));
  const flight = $derived(finishing.inFlight(row.rootId));
  const outcome = $derived(flight === null ? finishing.outcomeOf(row.rootId) : null);
  const phrase = $derived(phraseOf(row, facts, clock.now));
  const step = $derived(flight === null ? stepOf(row, facts) : null);
  const diff = $derived(facts?.diff != null && (facts.diff.added > 0 || facts.diff.removed > 0) ? facts.diff : null);
  const what = $derived.by(() => {
    if (main) return 'Project checkout';
    const thread = facts === null ? undefined : row.threads[0];
    const title = thread === undefined ? null : (names.of(thread)?.label.trim() ?? null);
    if (title) return title;
    return row.kind === 'external' ? 'Made outside Tagma' : null;
  });
</script>

{#snippet button(Icon: typeof GitMerge, words: string, run: () => void, primary: boolean)}
  <Button size="xs" variant={primary ? 'default' : 'outline'} class="pointer-events-auto relative" onclick={run} data-board-step={step}>
    <Icon class="size-3" />{words}
  </Button>
{/snippet}

<div
  class="group/row relative"
  data-board-row={row.name}
  aria-busy={flight !== null}
  out:fadeOut|global={{ finishing, rootId: row.rootId }}
  {@attach observe}
>
  <div
    class={[
      'relative flex items-center gap-3 rounded-md px-3 transition-colors',
      main ? 'h-11' : 'h-10',
      open ? 'bg-hover' : 'hover:bg-hover',
    ]}
    role="presentation"
    oncontextmenu={(event) => aim.aim(event)}
  >
    {#if href !== null}
      <a
        {href}
        class="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring"
        aria-label={label}
        data-board-link
      ></a>
    {/if}
    {#if here}<span class="pointer-events-none absolute inset-y-2 left-0 w-0.5 bg-brand" aria-hidden="true"></span>{/if}
    <span class="pointer-events-none flex min-w-0 flex-1 items-center gap-2 select-none">
      <WorktreeSwatch row={row.missing ? null : row} size="md" />
      <FadeText class="max-w-1/2 shrink-0 font-mono text-ui font-medium" text={label} />
      {#if what !== null}<FadeText class="flex-1 text-ui text-muted-foreground" text={what} data-board-what />{/if}
    </span>
    <span class="pointer-events-none flex w-18 shrink-0 items-center select-none">
      <AgentCounts waiting={row.agents.waiting} working={row.agents.working} />
    </span>
    <span class="pointer-events-none flex w-58 shrink-0 items-center select-none">
      {#if flight !== null}
        <ActLine {flight} class="max-w-full text-ui" />
      {:else if phrase !== null}
        <span
          class={['flex min-w-0 items-center gap-1.5 text-ui', phrase.hint !== null && 'pointer-events-auto relative']}
          title={phrase.hint ?? undefined}
          data-board-phrase={phrase.kind}
        >
          {#if phrase.pending}<Waiting class="size-3 text-muted-foreground" />{/if}
          <FadeText class={phrase.ink} text={phrase.words} />
          {#each phrase.asides as aside (aside)}
            <FadeText class="text-small text-muted-foreground" text={aside} />
          {/each}
        </span>
      {/if}
    </span>
    <span class="pointer-events-none flex w-26 shrink-0 items-center justify-end gap-1.5 font-mono text-small tabular select-none">
      {#if diff !== null}
        {#if diff.added > 0}<span class="text-status-done">+{diff.added}</span>{/if}
        {#if diff.removed > 0}<span class="text-destructive">−{diff.removed}</span>{/if}
      {/if}
    </span>
    <span class="flex w-27 shrink-0 items-center justify-end">
      {#if step === 'merge'}
        {@render button(GitMerge, 'Merge…', () => finishing.askMerge(row), true)}
      {:else if step === 'update'}
        {@render button(RefreshCw, 'Update', () => void finishing.update(row), false)}
      {:else if step === 'delete'}
        {@render button(Trash2, 'Delete', () => void finishing.remove(row), false)}
      {/if}
    </span>
    <span class="pointer-events-none relative flex h-full w-9 shrink-0 items-center justify-end">
      <span
        class={[
          'pointer-events-none text-small text-muted-foreground tabular transition-opacity select-none group-focus-within/row:opacity-0 group-hover/row:opacity-0',
          open && 'opacity-0',
        ]}
      >
        {row.movedAt === null ? '' : timeCompact(row.movedAt, clock.now)}
      </span>
      <DropdownMenu.Root bind:open={() => open, setOpen}>
        <DropdownMenu.Trigger
          class={[
            'pointer-events-auto absolute right-0 grid size-7 place-items-center rounded-md text-muted-foreground transition-opacity hover:bg-hover hover:text-foreground focus-visible:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100',
            open ? 'bg-selected text-foreground opacity-100' : 'opacity-0',
          ]}
          aria-label="Worktree actions"
        >
          <Ellipsis class="size-3.5" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          anchor={aim.anchor ?? undefined}
          align={aim.anchor === null ? 'end' : 'start'}
          sideOffset={aim.anchor === null ? undefined : 0}
          class="w-64"
          returnFocus={aim.anchor === null ? undefined : false}
        >
          <FinishItems {row}>
            {#snippet opens()}
              <DropdownMenu.Item
                icon={GitCompare}
                keys="click"
                disabled={href === null}
                onSelect={() => {
                  if (href !== null) void router.goto(href);
                }}
              >
                Open in Git
              </DropdownMenu.Item>
            {/snippet}
            {#snippet copies()}
              <DropdownMenu.Item
                icon={Copy}
                disabled={row.branch === null}
                onSelect={() => {
                  if (row.branch !== null) void navigator.clipboard.writeText(row.branch);
                }}
              >
                Copy branch name
              </DropdownMenu.Item>
            {/snippet}
          </FinishItems>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </span>
  </div>
  {#if outcome !== null}
    <div class="pr-3 pb-2 pl-8" data-board-outcome={row.name}>
      <OutcomeLine {outcome} class="text-small" />
    </div>
  {/if}
</div>
