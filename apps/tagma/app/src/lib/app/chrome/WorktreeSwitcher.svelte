<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import GitBranchPlus from '@lucide/svelte/icons/git-branch-plus';
  import LayoutList from '@lucide/svelte/icons/layout-list';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import type { ProjectBranch } from '@tagma/server/graph/contract/wire/rows';
  import { PROVISIONAL_NAME } from '@tagma/server/worktrees/contract/wire/creation';
  import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
  import { Host } from '@runlith/layer/Host';
  import { Router } from '@runlith/layer/Router';
  import { spellKey } from '$lib/shared/chordSpelling.js';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import MatchText from '$lib/shared/MatchText.svelte';
  import { ThreadOnScreen } from '$lib/features/threads/OnScreen.svelte.js';
  import { branchHref, currentProject } from '$lib/features/workspace/address.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { ProjectsRepo } from '$lib/features/workspace/ProjectsRepo.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import ActLine from '$lib/features/worktrees/ActLine.svelte';
  import { ACT_WORDS } from '$lib/features/worktrees/finishWords.js';
  import { Finishing } from '$lib/features/worktrees/Finishing.svelte.js';
  import NewWorktreeDialog from '$lib/features/worktrees/NewWorktreeDialog.svelte';
  import WorktreeFacts from '$lib/features/worktrees/WorktreeFacts.svelte';
  import WorktreeNameField from '$lib/features/worktrees/WorktreeNameField.svelte';
  import WorktreeSwatch from '$lib/features/worktrees/WorktreeSwatch.svelte';
  import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import AgentCounts from '$lib/shared/ui/AgentCounts.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { rank } from '@runlith/search-text/match';
  import * as Command from '$lib/shared/ui/command/index.js';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import { cn } from '$lib/shared/utils.js';
  import WorktreeCard from './WorktreeCard.svelte';

  const worktrees = Worktrees.use();
  const reading = worktrees.window();
  const finishing = Finishing.use();
  const projects = ProjectsRepo.use();
  const notices = Notices.use();
  const router = Router.use();
  const addresses = Addresses.use();
  const surfaces = SurfaceRegistry.use();
  const graphAim = GraphRung.Source.use();
  const onScreen = ThreadOnScreen.use();

  const aimed = $derived(graphAim()?.branch ?? null);
  const projectId = worktrees.aim.projectId;

  let branches = $state<readonly ProjectBranch[]>([]);
  let read = false;
  const checkedOut = $derived(
    worktrees.rows
      .flatMap((row) => (row.branch === null ? [] : [row.branch]))
      .sort()
      .join('\n'),
  );
  $effect(() => {
    void checkedOut;
    const load = read ? projects.branches.key(projectId).refresh({ throwOnError: true }) : projects.branches.key(projectId).loadOrThrow();
    read = true;
    void load
      .then((rows) => {
        if (rows) branches = rows;
      })
      .catch((error: unknown) => notices.refusal(error));
  });

  const standingBranch = $derived(branches.find((row) => (aimed === null ? row.canonical : row.branch === aimed)) ?? null);
  const several = $derived(worktrees.several);
  const here = $derived(worktrees.aimed);
  const unversioned = $derived(worktrees.main !== null && reading.rowOf(worktrees.main.rootId)?.reading === 'no-repository');
  const hereFlight = $derived(here === null ? null : finishing.inFlight(here.rootId));

  const page = $derived(onScreen.host?.projectId === projectId ? onScreen.host : null);
  const thread = $derived(page?.activeId ?? null);
  const picked = $derived(page?.birth.newWorktree ?? null);

  let open = $state(false);
  let query = $state('');
  let idleOpen = $state(false);
  let suggestion = $state('');

  const needle = $derived(query.trim().toLowerCase());
  const labelOf = (row: WorktreePlace): string => row.branch ?? row.name;
  const named = <T>(rows: readonly T[], label: (row: T) => string): readonly T[] =>
    rank(rows, query, (row) => ({ name: label(row) })).map(({ item }) => item);
  const resting = (row: WorktreePlace): boolean => row.agents.working + row.agents.waiting === 0;
  const byMovement = (left: WorktreePlace, right: WorktreePlace): number => (right.movedAt ?? '').localeCompare(left.movedAt ?? '');

  const listed = $derived(
    worktrees.rows.filter((row) => !row.missing && (row.kind !== 'external' || row.branch !== null || row.agents.standing > 0)),
  );
  const free = $derived(branches.filter((row) => row.worktree === null));
  const lead = $derived(worktrees.main !== null && worktrees.main.rootId !== here?.rootId ? [worktrees.main] : []);
  const rest = $derived(listed.filter((row) => row.kind !== 'main' && row.rootId !== here?.rootId));
  const active = $derived(rest.filter((row) => !resting(row)).sort(byMovement));
  const idle = $derived(rest.filter(resting).sort(byMovement));

  const shownRows = $derived(needle !== '' ? named(listed, labelOf) : several ? [...lead, ...active] : listed);
  const shownCreations = $derived(needle === '' ? worktrees.creations : named(worktrees.creations, (creation) => creation.label));
  const shownBranches = $derived(needle !== '' ? named(free, (row) => row.branch) : several ? [] : free);
  const nothing = $derived(needle !== '' && shownRows.length === 0 && shownCreations.length === 0 && shownBranches.length === 0);

  function aimAt(branch: string | null, rootId: string | null): void {
    const leaving = thread !== null && rootId !== here?.rootId;
    if (!leaving) page?.birth.pickNewWorktree(null);
    void router.goto(leaving ? addresses.place(currentProject(router), surfaces.home, null, branch) : branchHref(router, branch));
  }

  function go(row: WorktreePlace): void {
    open = false;
    if (row.branch !== null) aimAt(row.kind === 'main' ? null : row.branch, row.rootId);
  }

  async function openAsWorktree(branch: string): Promise<void> {
    open = false;
    const rootId = await worktrees.checkout(branch);
    if (rootId !== null) aimAt(branch, rootId);
  }

  function create(): void {
    suggestion = query.trim();
    open = false;
    worktrees.creating = true;
  }

  function ownForDraft(): void {
    page?.birth.pickNewWorktree({ base: here === null || here.kind === 'main' ? null : here.branch, name: null });
  }

  function nameNew(value: string): void {
    if (picked !== null) page?.birth.pickNewWorktree({ base: picked.base, name: value === '' ? null : value });
  }

  function factsOf(row: WorktreePlace): string {
    return [
      row.folder,
      row.base === null ? null : `from ${row.base.branch ?? row.base.commit.slice(0, 7)}`,
      row.head === null ? null : `HEAD ${row.head}`,
    ]
      .filter((part) => part !== null)
      .join(' · ');
  }

  const ROW = 'h-7 gap-2 px-2 py-0 text-small [&>.cn-command-item-indicator]:hidden';
  const GO = 'hidden shrink-0 items-center gap-1.5 text-small text-foreground group-data-highlighted/command-item:flex';
  const enter = spellKey('Enter', Host.use().apple);
  const LABEL = 'px-3 pt-2 pb-1 text-small font-semibold text-muted-foreground';
  const NO_REPOSITORY = 'The project folder is not a Git repository, so there is nothing to cut a worktree from';
  const keep = (event: KeyboardEvent): void => event.stopPropagation();
</script>

{#snippet worktreeItem(row: WorktreePlace)}
  {@const flight = finishing.inFlight(row.rootId)}
  {@const current = row.rootId === worktrees.aimed?.rootId && picked === null}
  <Command.Item
    value={`wt:${row.rootId}`}
    disabled={row.branch === null}
    onSelect={() => go(row)}
    title={factsOf(row)}
    class={ROW}
    data-worktree-row={row.name}
  >
    <span class="flex min-w-0 flex-1 items-center gap-2" {@attach reading.observe(row.rootId)}>
      <WorktreeSwatch {row} />
      <FadeText class="flex-1 font-mono text-small"><MatchText text={labelOf(row)} {query} /></FadeText>
    </span>
    {#if !current}
      <span class={GO}>Go<Kbd chord={enter} size="sm" /></span>
    {/if}
    <span class={['flex shrink-0 items-center gap-1.5', !current && 'group-data-highlighted/command-item:hidden']}>
      {#if flight !== null}
        <ActLine {flight} phase={false} class="max-w-[10rem]" />
      {:else}
        {#if row.kind === 'main'}<span class="text-small text-muted-foreground/70">main</span>{/if}
        <WorktreeFacts {row} facts={reading.rowOf(row.rootId)} unread={reading.unread} diffClass="hidden" />
      {/if}
    </span>
    {#if current}<Check class="size-3.5 shrink-0 text-brand" />{/if}
  </Command.Item>
{/snippet}

{#if worktrees.known || branches.length > 0}
  <Popover.Root
    bind:open
    onOpenChange={(next) => {
      if (next) query = '';
    }}
  >
    <Tooltip
      text={picked !== null
        ? 'This draft starts in a new worktree, made with its first turn'
        : `${here?.branch ?? standingBranch?.branch ?? aimed ?? 'no branch'}$ — ${
            several
              ? 'the worktree this frame stands in: its graph, its Git, its agents, and where a new thread or terminal starts'
              : 'the branch of the graph this frame is aimed at'
          }`}
    >
      <Popover.Trigger
        class={cn(
          'no-drag-region flex h-7 items-center gap-1.5 rounded-md px-1.5 text-ui text-muted-foreground transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-selected',
          'max-w-64 min-w-10 shrink-[3]',
          picked !== null && 'worktree-switch--new text-foreground',
        )}
        data-worktree-switcher
      >
        <span
          class="flex min-w-0 items-center gap-1.5"
          {@attach here === null || picked !== null ? undefined : reading.observe(here.rootId)}
        >
          {#if picked !== null}
            <Plus class="size-3.5 shrink-0" />
            <FadeText
              class="font-mono"
              text={`${picked.name ?? 'new worktree'} · from ${picked.base ?? worktrees.main?.branch ?? 'main'}`}
            />
          {:else if several && here !== null}
            <WorktreeSwatch row={here} size="md" />
            <FadeText class="font-mono" text={here.branch ?? here.name} />
            {#if hereFlight !== null}
              <Waiting class="size-3 text-muted-foreground" label={ACT_WORDS[hereFlight.act]} />
            {:else}
              <AgentCounts waiting={here.agents.waiting} working={here.agents.working} />
            {/if}
          {:else}
            <GitBranch class="size-3.5 shrink-0" />
            <FadeText text={here?.branch ?? standingBranch?.branch ?? aimed ?? 'no branch'} />
            {#if here !== null}<AgentCounts waiting={here.agents.waiting} working={here.agents.working} />{/if}
          {/if}
          <ChevronsUpDown class="size-3.5 shrink-0 opacity-60" />
        </span>
      </Popover.Trigger>
    </Tooltip>
    <Popover.Content
      align="start"
      collisionPadding={12}
      class="w-[25rem] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
      style="max-height: min(32.5rem, var(--float-available-height, 100dvh));"
      data-worktree-switcher-menu
    >
      <Command.Root class="min-h-0 flex-1 rounded-none! bg-transparent p-0">
        <Command.Input bind:value={query} placeholder={several ? 'Go to worktree or branch…' : 'Go to branch…'} class="text-ui" />
        {#if needle === ''}
          {#if picked !== null}
            <div class="mt-1 grid gap-1.5 border-y bg-hover px-3 pt-2 pb-2" data-worktree-pick>
              <div class="flex min-w-0 items-center gap-2">
                <WorktreeSwatch row={null} size="md" />
                <FadeText class="flex-1 font-mono text-ui" text={`new worktree from ${picked.base ?? worktrees.main?.branch ?? 'main'}`} />
                <Button variant="ghost" size="xs" onkeydown={keep} onclick={() => page?.birth.pickNewWorktree(null)}>Cancel</Button>
              </div>
              <div class="pl-5">
                <WorktreeNameField
                  bind:value={() => picked?.name ?? '', nameNew}
                  size="sm"
                  placeholder={`${PROVISIONAL_NAME}-······`}
                  label="New worktree name"
                  onkeydown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Escape' || event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
                  }}
                />
              </div>
              <div class="pl-5 text-small text-muted-foreground">Made with this draft’s first message.</div>
            </div>
          {:else if several && here !== null}
            <div class="mt-1 border-t">
              <div class={LABEL}>You are in</div>
              <WorktreeCard row={here} onDone={() => (open = false)} />
            </div>
          {/if}
        {/if}
        <Command.List class="max-h-none min-h-0 flex-1 overscroll-contain p-1">
          {#if shownRows.length > 0 || shownCreations.length > 0 || (needle === '' && idle.length > 0)}
            <Command.Group heading={several ? (needle === '' ? 'Go to' : 'Worktrees') : 'Checkout'} class="p-0">
              {#each shownRows as row (row.rootId)}{@render worktreeItem(row)}{/each}
              {#each shownCreations as creation (creation.id)}
                <Command.Item value={`mk:${creation.id}`} disabled class={ROW}>
                  <WorktreeSwatch row={null} />
                  <FadeText class="flex-1 font-mono text-small" text={creation.label} />
                  <span class={cn('shrink-0 text-small', creation.phase === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
                    {creation.phase === 'checkout' ? 'checking out' : creation.phase}
                  </span>
                </Command.Item>
              {/each}
              {#if needle === '' && several && idle.length > 0}
                <Command.Item
                  value="fold:idle"
                  onSelect={() => (idleOpen = !idleOpen)}
                  class={cn(ROW, 'text-muted-foreground')}
                  data-worktree-idle
                >
                  <ChevronRight class={cn('size-3.5 transition-transform', idleOpen && 'rotate-90')} />
                  <span class="shrink-0">{idle.length} more, quiet</span>
                  {#if !idleOpen}
                    <FadeText
                      class="flex-1 text-right font-mono text-meta text-muted-foreground/60"
                      text={idle.slice(0, 3).map(labelOf).join(', ')}
                    />
                  {/if}
                </Command.Item>
                {#if idleOpen}
                  {#each idle as row (row.rootId)}{@render worktreeItem(row)}{/each}
                {/if}
              {/if}
            </Command.Group>
          {/if}
          {#if shownBranches.length > 0}
            <Command.Group heading="Branches without a worktree" class="p-0">
              {#each shownBranches as row (row.branch)}
                <Command.Item value={`br:${row.branch}`} onSelect={() => void openAsWorktree(row.branch)} class={ROW}>
                  <GitBranch class="size-3.5 text-muted-foreground/70" />
                  <FadeText class="flex-1 font-mono text-small text-muted-foreground"><MatchText text={row.branch} {query} /></FadeText>
                  <span class="shrink-0 text-small text-muted-foreground/70 group-data-highlighted/command-item:hidden"
                    >Create &amp; go</span
                  >
                  <span class={GO}>Create &amp; go<Kbd chord={enter} size="sm" /></span>
                </Command.Item>
              {/each}
            </Command.Group>
          {/if}
          {#if nothing}
            <div class="py-5 text-center text-small text-muted-foreground">No worktree or branch by that name</div>
          {/if}
        </Command.List>
        {#if thread !== null && several && here !== null}
          <div class="mx-2 mb-1.5 rounded-md bg-hover px-3 py-1.5 text-small leading-snug text-muted-foreground" data-worktree-thread-note>
            The open thread stays in <span class="font-mono text-foreground/85">{here.branch ?? here.name}</span>. To take it along: thread
            <span class="text-foreground/85">⋯ → Move to worktree</span>.
          </div>
        {/if}
      </Command.Root>
      <div class="flex min-w-0 items-center gap-0.5 border-t p-1">
        <Tooltip text={unversioned ? NO_REPOSITORY : null} class="flex min-w-0">
          <Button variant="ghost" size="sm" class="min-w-0 text-ui" disabled={unversioned} onclick={create}>
            <Plus class="size-3.5 text-muted-foreground" />
            <FadeText text={needle === '' ? 'New worktree…' : `New worktree “${query.trim()}”…`} />
          </Button>
        </Tooltip>
        {#if page !== null && thread === null && picked === null}
          <Tooltip text={unversioned ? NO_REPOSITORY : 'Start this draft in a new worktree, made with its first message'} class="flex">
            <Button variant="ghost" size="sm" class="text-ui" disabled={unversioned} onclick={ownForDraft} data-worktree-new-agent>
              <GitBranchPlus class="size-3.5 text-muted-foreground" />
              Draft in a new worktree
            </Button>
          </Tooltip>
        {/if}
        <span class="flex-1"></span>
        {#if several}
          <Button
            variant="ghost"
            size="sm"
            class="text-ui"
            onclick={() => {
              open = false;
              void router.goto(addresses.git('board', aimed));
            }}
            data-all-worktrees
          >
            <LayoutList class="size-3.5 text-muted-foreground" />
            All worktrees
          </Button>
        {/if}
      </div>
    </Popover.Content>
  </Popover.Root>
  <NewWorktreeDialog
    bind:open={worktrees.creating}
    from={here?.branch ?? null}
    suggested={suggestion}
    onCreated={(branch) => aimAt(branch, null)}
  />
{/if}

<style>
  :global(.worktree-switch--new) {
    border: 1px dashed color-mix(in oklch, var(--color-foreground) 30%, transparent);
  }
</style>
