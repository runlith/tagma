<script lang="ts">
  import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
  import FactStamp from './FactStamp.svelte';
  import MergeFact from './MergeFact.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Eraser from '@lucide/svelte/icons/eraser';
  import GitCompare from '@lucide/svelte/icons/git-compare';
  import GitMerge from '@lucide/svelte/icons/git-merge';
  import Plus from '@lucide/svelte/icons/plus';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import type { WorktreePlace, WorktreeRow } from '@tagma/server/worktrees/contract/wire/rows';
  import { Router } from '@runlith/layer/Router';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { timeCompact } from '$lib/shared/time.js';
  import PageHeader from '$lib/shared/PageHeader.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import ActLine from './ActLine.svelte';
  import { baseName } from './BaseReading.svelte.js';
  import FinishItems from './FinishItems.svelte';
  import { Finishing } from './Finishing.svelte.js';
  import { fadeOut } from './leave.js';
  import OutcomeLine from './OutcomeLine.svelte';
  import NewWorktreeDialog from './NewWorktreeDialog.svelte';
  import { Cleanup } from './Cleanup.svelte.js';
  import { STATUS_WORDS } from './tone.js';
  import { Worktrees } from './BoardState.svelte.js';
  import WorktreeSwatch from './WorktreeSwatch.svelte';

  const worktrees = Worktrees.use();
  const reading = worktrees.window();
  const unread = $derived(reading.unread ?? worktrees.unread);
  const finishing = Finishing.use();
  const cleanup = Cleanup.use();
  const router = Router.use();
  const addresses = Addresses.use();

  const rows = $derived(worktrees.rows.filter((row) => row.kind !== 'external' || row.branch !== null || row.agents.standing > 0));

  let creating = $state(false);
  let now = $state(Date.now());

  $effect(() => {
    const tick = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(tick);
  });

  const openable = (row: WorktreePlace): boolean => !row.missing && (row.kind === 'main' || row.branch !== null);

  function open(row: WorktreePlace): void {
    if (openable(row)) void router.goto(addresses.git('tree', row.kind === 'main' ? null : row.branch));
  }

  type Next = { readonly label: string; readonly primary: boolean; readonly run: () => void };

  function nextOf(row: WorktreePlace, facts: WorktreeRow | null): Next {
    const into = baseName(row);
    if (row.kind !== 'tagma') return { label: 'Open', primary: false, run: () => open(row) };
    if (row.pending?.state === 'waiting')
      return { label: `Waiting for ${into} · Stop`, primary: false, run: () => void finishing.cancelMerge(row) };
    if (row.pending?.state === 'stopped')
      return { label: 'Merge stopped · Dismiss', primary: false, run: () => void finishing.cancelMerge(row) };
    if (row.missing) return { label: 'Delete', primary: false, run: () => void finishing.remove(row) };
    if (facts?.stateFact.state !== 'current' || facts.mergeFact.state !== 'current')
      return { label: 'Open', primary: false, run: () => open(row) };
    switch (facts.status) {
      case 'missing':
        return { label: 'Delete', primary: false, run: () => void finishing.remove(row) };
      case 'ready':
        return { label: 'Merge…', primary: true, run: () => finishing.askMerge(row) };
      case 'conflicts':
      case 'behind':
        return { label: `Update from ${into}`, primary: false, run: () => void finishing.update(row) };
      case 'merged':
        return { label: 'Delete', primary: false, run: () => void finishing.remove(row) };
      default:
        return { label: 'Open', primary: false, run: () => open(row) };
    }
  }

  const dots = (row: WorktreePlace): readonly string[] => {
    const rest = Math.max(0, row.agents.standing - row.agents.working - row.agents.waiting - row.agents.finished);
    return [
      ...Array<string>(row.agents.working).fill('bg-status-in-work'),
      ...Array<string>(row.agents.waiting).fill('bg-status-open'),
      ...Array<string>(row.agents.finished).fill('bg-status-done'),
      ...Array<string>(rest).fill('bg-muted-foreground/35'),
    ];
  };

  const TH = 'h-8 px-3 text-left text-small font-medium text-muted-foreground whitespace-nowrap';
  const TD = 'h-9 px-3 text-ui whitespace-nowrap';
</script>

<div class="h-full min-h-0 overflow-auto" data-worktree-board>
  <div class="page-wide pt-8 pb-16">
    <PageHeader title="Worktrees" caption={`${rows.length} standing`} class="mb-6">
      {#snippet actions()}
        <Button size="sm" variant="ghost" class="gap-1.5" onclick={() => cleanup.show()} data-board-cleanup>
          <Eraser class="size-3.5" />
          Clean up…
        </Button>
        <Button size="sm" variant="outline" class="gap-1.5" onclick={() => (creating = true)}>
          <Plus class="size-3.5" />
          New worktree
        </Button>
      {/snippet}
    </PageHeader>

    {#if unread !== null}
      <p class="mb-4 flex items-start gap-1.5 text-small text-destructive" role="status" data-board-unread>
        <AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
        <span>The worktree list stopped updating, and the rows below are as they last stood: {unread}</span>
      </p>
    {/if}

    <div>
      <table class="w-full min-w-[60rem] border-collapse">
        <thead class="sticky top-0 bg-background">
          <tr class="border-b">
            <th class={TH}>Worktree</th>
            <th class={TH}>Agents</th>
            <th class={TH}>Status</th>
            <th class={TH}>Uncommitted</th>
            <th class={TH}>vs base</th>
            <th class={TH}>Changes</th>
            <th class={TH}>Merge check</th>
            <th class={TH}>Last</th>
            <th class={TH}><span class="sr-only">Next</span></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.rootId)}
            {@const facts = reading.rowOf(row.rootId)}
            {@const status = STATUS_WORDS[facts?.status ?? 'reading']}
            {@const next = nextOf(row, facts)}
            {@const lights = dots(row)}
            {@const flight = finishing.inFlight(row.rootId)}
            {@const outcome = flight === null ? finishing.outcomeOf(row.rootId) : null}
            <tr
              class={[
                'group/board transition-colors hover:bg-hover',
                outcome === null && 'border-b',
                worktrees.aimed?.rootId === row.rootId && 'bg-selected',
              ]}
              data-board-row={row.name}
              aria-busy={flight !== null}
              out:fadeOut|global={{ finishing, rootId: row.rootId }}
              {@attach reading.observe(row.rootId)}
            >
              <td class={TD}>
                <button
                  type="button"
                  class="flex min-w-0 items-center gap-2 text-left hover:underline underline-offset-4"
                  onclick={() => open(row)}
                >
                  <WorktreeSwatch {row} />
                  <FadeText class="max-w-72 font-mono text-small font-medium" text={row.branch ?? row.name} />
                  {#if row.base !== null}
                    <span class="text-small text-muted-foreground">from {baseName(row)}</span>
                  {/if}
                </button>
                {#if row.head !== null}
                  <span class="flex items-center gap-2 pl-4 text-meta text-muted-foreground" title={row.head}>
                    <span class="font-mono">HEAD {row.head.slice(0, 7)}</span>
                    {#if row.headTime !== null}<span>{timeCompact(new Date(row.headTime).toISOString(), now)}</span>{/if}
                  </span>
                {/if}
              </td>
              <td class={TD}>
                <span class="flex items-center gap-1" role="img" aria-label="{row.agents.standing} agents">
                  {#each lights.slice(0, 8) as ink, index (index)}
                    <span class={['size-1.5 rounded-full', ink]}></span>
                  {/each}
                  {#if lights.length > 8}<span class="ml-0.5 text-small text-muted-foreground">+{lights.length - 8}</span>{/if}
                  {#if lights.length === 0}<span class="text-muted-foreground/60">—</span>{/if}
                </span>
              </td>
              <td class={[TD, 'w-52 max-w-52']}>
                {#if flight !== null}
                  <ActLine {flight} class="h-5 max-w-full text-small" />
                {:else if facts === null}
                  <span class="text-muted-foreground">{row.missing ? 'missing' : 'not taken'}</span>
                {:else if !row.missing && (facts.stateFact.state !== 'current' || (row.kind === 'tagma' && facts.mergeFact.state !== 'current'))}
                  <FactStamp fact={facts.stateFact.state === 'current' ? facts.mergeFact : facts.stateFact} head={row.head} />
                {:else}
                  <span
                    class={['inline-flex h-5 items-center rounded-full px-2 text-small font-medium', status.ink]}
                    style:background="color-mix(in oklch, currentColor 11%, transparent)"
                    data-board-status={facts?.status}
                  >
                    {status.word}
                  </span>
                {/if}
              </td>
              <td
                class={[TD, 'tabular-nums', (facts?.uncommitted ?? 0) === 0 && 'text-muted-foreground']}
                data-board-reading={facts?.reading}
              >
                {(facts?.uncommitted ?? null) === null
                  ? facts?.reading === 'failed'
                    ? 'unreadable'
                    : '—'
                  : facts?.uncommitted === 0
                    ? 'none'
                    : `${facts?.uncommitted} ${facts?.uncommitted === 1 ? 'file' : 'files'}`}
              </td>
              <td class={[TD, 'font-mono text-small tabular-nums']}>
                {#if (facts?.ahead ?? null) === null && (facts?.behind ?? null) === null}
                  <span class="text-muted-foreground/60">—</span>
                {:else}
                  ↑{facts?.ahead ?? 0} <span class={(facts?.behind ?? 0) > 0 ? 'text-status-stale' : ''}>↓{facts?.behind ?? 0}</span>
                {/if}
              </td>
              <td class={[TD, 'font-mono text-small tabular-nums']}>
                {#if (facts?.diff ?? null) === null || (facts?.diff?.added === 0 && facts?.diff?.removed === 0)}
                  <span class="text-muted-foreground/60">—</span>
                {:else}
                  {#if (facts?.diff?.added ?? 0) > 0}<span class="text-status-done">+{facts?.diff?.added}</span>{/if}
                  {#if (facts?.diff?.removed ?? 0) > 0}<span class="text-destructive/80">−{facts?.diff?.removed}</span>{/if}
                {/if}
              </td>
              <td class={TD} data-board-check={facts?.check}>
                {#if facts !== null}<MergeFact row={facts} />{:else}<span class="text-muted-foreground">not taken</span>{/if}
              </td>
              <td class={[TD, 'text-small text-muted-foreground tabular-nums']}
                >{row.movedAt === null ? '' : timeCompact(row.movedAt, now)}</td
              >
              <td class={[TD, 'w-0 pr-3']}>
                <span class="flex items-center justify-end gap-1">
                  <Button
                    size="sm"
                    variant={next.primary ? 'default' : 'outline'}
                    class="gap-1.5"
                    disabled={flight !== null || (next.label === 'Open' && !openable(row))}
                    onclick={next.run}
                    data-board-next={next.label}
                  >
                    {#if next.primary}<GitMerge
                        class="size-3.5"
                      />{:else if facts?.status === 'conflicts' || facts?.status === 'behind'}<RefreshCw class="size-3.5" />{/if}
                    {next.label}
                  </Button>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger
                      class="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-selected"
                      aria-label="Worktree actions"
                    >
                      <Ellipsis class="size-3.5" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end" class="w-64">
                      <FinishItems {row}>
                        {#snippet opens()}
                          <DropdownMenu.Item icon={GitCompare} disabled={!openable(row)} onSelect={() => open(row)}
                            >Open in Git</DropdownMenu.Item
                          >
                        {/snippet}
                      </FinishItems>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </span>
              </td>
            </tr>
            {#if outcome !== null}
              <tr class="border-b" data-board-outcome={row.name}>
                <td colspan="9" class="px-3 pb-2">
                  <OutcomeLine {outcome} class="max-w-[48rem] text-small" />
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>

      {#if finishing.departed.length > 0}
        <div class="grid gap-1.5 border-b px-4 py-2" data-board-departed>
          {#each finishing.departed as outcome (outcome.id)}
            <OutcomeLine {outcome} named class="max-w-[48rem] text-small" />
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<NewWorktreeDialog bind:open={creating} from={worktrees.aimed?.branch ?? null} />
