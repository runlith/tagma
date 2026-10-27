<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import LayoutList from '@lucide/svelte/icons/layout-list';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Upload from '@lucide/svelte/icons/upload';
  import Users from '@lucide/svelte/icons/users';
  import X from '@lucide/svelte/icons/x';
  import type { CheckoutEntry, ComparedPath } from '@tagma/server/workspace/contract/wire/checkout';
  import { OPERATIONS } from '@tagma/server/composition/catalog';
  import SeamHandle from '@runlith/seam/SeamHandle.svelte';
  import { Seam } from '@runlith/seam/Seam.svelte';
  import Button from '$lib/shared/ui/button/button.svelte';
  import DialogContent from '$lib/shared/ui/dialog/dialog-content.svelte';
  import DialogDescription from '$lib/shared/ui/dialog/dialog-description.svelte';
  import DialogFooter from '$lib/shared/ui/dialog/dialog-footer.svelte';
  import DialogHeader from '$lib/shared/ui/dialog/dialog-header.svelte';
  import Dialog from '$lib/shared/ui/dialog/dialog.svelte';
  import DialogTitle from '$lib/shared/ui/dialog/dialog-title.svelte';
  import DropdownMenuContent from '$lib/shared/ui/dropdown-menu/dropdown-menu-content.svelte';
  import DropdownMenuGroup from '$lib/shared/ui/dropdown-menu/dropdown-menu-group.svelte';
  import DropdownMenuGroupHeading from '$lib/shared/ui/dropdown-menu/dropdown-menu-group-heading.svelte';
  import DropdownMenuRadioGroup from '$lib/shared/ui/dropdown-menu/dropdown-menu-radio-group.svelte';
  import DropdownMenuRadioItem from '$lib/shared/ui/dropdown-menu/dropdown-menu-radio-item.svelte';
  import DropdownMenu from '$lib/shared/ui/dropdown-menu/dropdown-menu.svelte';
  import DropdownMenuTrigger from '$lib/shared/ui/dropdown-menu/dropdown-menu-trigger.svelte';
  import PathText from '$lib/shared/PathText.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { type OpenHow, Tabs } from '$lib/features/checkout/files/Tabs.svelte.js';
  import { Seams } from '$lib/shared/seams/Seams.svelte.js';
  import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
  import { Router } from '@runlith/layer/Router';
  import { currentCommit } from '$lib/features/workspace/address.js';
  import ChangeList from './ChangeList.svelte';
  import ChangeSection from './ChangeSection.svelte';
  import { insetOf } from './changeItem.js';
  import { Holdings } from './Holdings.svelte.js';
  import { Checkout } from './Selection.svelte.js';
  import { CheckoutRepo, type PushAim } from './Repo.js';
  import CommitBox from './CommitBox.svelte';
  import CommitFiles from './CommitFiles.svelte';
  import { CommitFlow } from './CommitFlow.svelte.js';
  import CommitList from './CommitList.svelte';
  import FastStatusOffer from './FastStatusOffer.svelte';
  import GroupingToggle from './GroupingToggle.svelte';
  import { BY_THREAD } from './grouping.js';
  import { GitLists, sideOf, type Side } from './GitLists.svelte.js';
  import LineCount from './LineCount.svelte';
  import { PathCommits } from './PathCommits.svelte.js';
  import { headOf, OPERATION_WORD, readingWord, SHORT_SHA } from './reading.js';
  import RowAct from './RowAct.svelte';
  import { LOG_SEAM } from './seams.js';
  import type { ThreadGroupEntry } from './threadGroups.js';
  import ViewMenu from './ViewMenu.svelte';

  const LOG_ROW = 26;

  type SyncKind = 'publish' | 'pull' | 'push';

  const SYNC = {
    publish: { label: 'Publish', icon: Upload },
    pull: { label: 'Pull', icon: ArrowDown },
    push: { label: 'Push', icon: ArrowUp },
  } as const;

  let { onBoard }: { onBoard?: (() => void) | undefined } = $props();

  const checkout = Checkout.use();
  const holdings = Holdings.use();
  const lists = GitLists.use();
  const seams = Seams.use();
  const marks = ReaderMarks.use();
  const repo = CheckoutRepo.use();
  const notices = Notices.use();
  const tabs = Tabs.use();
  const router = Router.use();
  const flow = new CommitFlow(repo);

  const row = $derived(checkout.row);
  const rootId = $derived(row?.rootId ?? null);

  const logSeam = new Seam(seams.seam(LOG_SEAM), { onCommit: (size) => seams.set(LOG_SEAM, size) });

  type Pending =
    | { readonly act: 'discard'; readonly paths: readonly string[] }
    | { readonly act: 'amend'; readonly message: string; readonly rootId: NonNullable<typeof rootId> }
    | { readonly act: 'abort' };

  type Asked = ReturnType<typeof OPERATIONS.discard_checkout.confirmation> & {
    readonly confirmLabel: string;
    readonly intent?: 'destructive';
  };

  const askedOf = (pending: Pending, selected: NonNullable<typeof row>): Asked => {
    const at = { at: { judged: selected.path } };
    if (pending.act === 'discard')
      return {
        ...OPERATIONS.discard_checkout.confirmation({ rootId: selected.rootId, paths: pending.paths }, at),
        confirmLabel: OPERATIONS.discard_checkout.confirmLabel,
        intent: OPERATIONS.discard_checkout.intent,
      };
    if (pending.act === 'abort')
      return {
        ...OPERATIONS.abort_checkout.confirmation({ rootId: selected.rootId }, at),
        confirmLabel: OPERATIONS.abort_checkout.confirmLabel,
        intent: OPERATIONS.abort_checkout.intent,
      };
    return {
      ...OPERATIONS.commit_checkout.confirmation({ rootId: pending.rootId, message: pending.message, amend: true }, at),
      confirmLabel: OPERATIONS.commit_checkout.confirmLabel,
    };
  };

  let pending = $state<Pending | null>(null);

  const head = $derived(row === null ? '' : headOf(row));
  const word = $derived(row === null ? null : readingWord(row));

  const conflicts = $derived(lists.conflicts);
  const staged = $derived(lists.staged);
  const changes = $derived(lists.changes);
  const graph = $derived(lists.graph);

  const open = $derived.by(() => {
    const tab = tabs.active;
    return tab !== null && tab.kind === 'diff' && tab.rootId === rootId ? tab : null;
  });
  const openCommit = $derived(open?.diff?.commit ?? null);

  const workingPath = $derived(open !== null && openCommit === null ? open.path : null);

  const selectedAt = (side: Side): string | null =>
    open !== null && openCommit === null && (open.diff?.side ?? null) === side ? open.path : null;

  const linked = $derived(currentCommit(router));

  const log = new PathCommits(repo, () =>
    rootId === null || row?.repository === false ? null : { projectId: checkout.projectId, rootId },
  );
  const logLines = $derived(log.lines ?? []);
  const linkedListed = $derived(linked !== null && logLines.some((line) => line.full === linked));

  let dock = $state<HTMLElement | null>(null);
  const logOpen = $derived(marks.foldedSides.get('git-commits') !== 'shut');

  $effect(() => {
    if (dock === null) return;
    log.measured(Math.max(8, Math.floor(dock.clientHeight / LOG_ROW) + 1));
  });

  let seenHead: string | null | undefined;
  $effect(() => {
    const now = row?.head ?? null;
    if (seenHead !== undefined && seenHead !== now) log.reset();
    seenHead = now;
  });

  $effect(() => {
    if (log.failed !== undefined && log.failed !== null) notices.refusal(log.failed);
  });

  let draft = $state('');

  function show(path: string, commit: string | null = null, side: Side = null, how: OpenHow = 'preview'): void {
    if (rootId === null) return;
    tabs.open({ rootId, path, kind: 'diff', diff: { commit, side } }, how);
  }

  async function act(work: Promise<unknown>): Promise<void> {
    try {
      await work;
    } catch (error) {
      notices.refusal(error);
    }
  }

  function stage(paths: readonly string[]): void {
    if (rootId !== null && paths.length > 0) void act(repo.stage.run({ rootId, paths }, { throwOnError: true }));
  }

  function unstage(paths: readonly string[]): void {
    if (rootId !== null && paths.length > 0) void act(repo.unstage.run({ rootId, paths }, { throwOnError: true }));
  }

  function discard(paths: readonly string[]): void {
    if (paths.length > 0) pending = { act: 'discard', paths };
  }

  const pushAim = $derived.by<PushAim | null>(() => {
    if (row === null || rootId === null || row.ref === null) return null;
    if (row.upstream !== null) return { rootId };
    return !row.publishTo ? null : { rootId, publish: { remote: row.publishTo, branch: row.ref } };
  });

  const sync = $derived.by<SyncKind | null>(() => {
    if (row === null || row.ref === null || row.head === null || row.operation !== 'none') return null;
    if (row.upstream === null) return !row.publishTo ? null : 'publish';
    if (row.ahead === null || row.behind === null) return 'push';
    if (row.behind > 0) return 'pull';
    if (row.ahead > 0) return 'push';
    return null;
  });

  let busy = $state<'sync' | 'fetch' | null>(null);

  function remote(kind: 'sync' | 'fetch', work: () => Promise<unknown>): void {
    if (busy !== null) return;
    busy = kind;
    void act(work()).finally(() => (busy = null));
  }

  function syncNow(): void {
    const kind = sync;
    const aim = pushAim;
    if (kind === null || rootId === null) return;
    if (kind === 'pull') remote('sync', () => repo.pull.run({ rootId }, { throwOnError: true }));
    else if (aim !== null) remote('sync', () => repo.push.run(aim, { throwOnError: true }));
  }

  function fetchNow(): void {
    if (rootId !== null) remote('fetch', () => repo.fetch.run({ rootId }, { throwOnError: true }));
  }

  function commit(input: { message: string; amend?: boolean; push?: boolean }): void {
    if (input.amend === true) {
      if (rootId !== null) pending = { act: 'amend', message: input.message, rootId };
    } else commitNow(input.message, false, input.push === true ? pushAim : null);
  }

  function commitNow(message: string, amend: boolean, aim: PushAim | null, skipSteps = false): void {
    if (rootId === null || repo.commit.pending) return;
    const attempt = { rootId, message, amend, aim };
    const committing = () =>
      flow.run(attempt, skipSteps, () => {
        if (draft.trim() === message) draft = '';
      });
    if (aim === null) void act(committing());
    else remote('sync', committing);
  }

  function confirm(): void {
    const asked = pending;
    pending = null;
    if (asked === null || rootId === null) return;
    if (asked.act === 'discard') void act(repo.discard.run({ rootId, paths: asked.paths }, { throwOnError: true }));
    else if (asked.act === 'abort') void act(repo.abort.run({ rootId }, { throwOnError: true }));
    else commitNow(asked.message, true, null);
  }

  const pathsOf = (entries: readonly { readonly path: string }[]): readonly string[] => entries.map((entry) => entry.path);

  const CHIP = 'shrink-0 rounded-sm px-1 font-mono text-meta tabular-nums text-muted-foreground';
</script>

{#snippet stageAct(paths: readonly string[])}
  <RowAct label="Stage" icon={Plus} onclick={() => stage(paths)} />
{/snippet}
{#snippet unstageAct(paths: readonly string[])}
  <RowAct label="Unstage" icon={Minus} onclick={() => unstage(paths)} />
{/snippet}
{#snippet discardAct(paths: readonly string[])}
  <RowAct label="Discard changes" icon={Undo2} onclick={() => discard(paths)} />
{/snippet}

{#snippet conflictActs(entry: CheckoutEntry)}
  {@render stageAct([entry.path])}
{/snippet}
{#snippet stagedActs(entry: CheckoutEntry)}
  {@render unstageAct([entry.path])}
{/snippet}
{#snippet changeActs(entry: CheckoutEntry)}
  {@render discardAct([entry.path])}
  {@render stageAct([entry.path])}
{/snippet}
{#snippet threadActs(item: ThreadGroupEntry)}
  {#if item.unstaged}{@render discardAct([item.path])}{/if}
  {#if item.staged}{@render unstageAct([item.path])}{/if}
  {#if item.unstaged}{@render stageAct([item.path])}{/if}
{/snippet}

{#snippet groupingExtra()}
  <DropdownMenuGroup>
    <DropdownMenuGroupHeading>Group changes</DropdownMenuGroupHeading>
    <DropdownMenuRadioGroup value={lists.threadMode ? 'thread' : 'status'} onValueChange={(next) => marks.grouping.set(BY_THREAD, next)}>
      <DropdownMenuRadioItem value="status" icon={ListChecks}>By status</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="thread" icon={Users}>By holder</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  </DropdownMenuGroup>
{/snippet}

{#if row !== null && !row.repository}
  <div class="grid gap-1 p-3" data-checkout-unversioned>
    <p class="text-ui text-foreground">This project folder is not under Git</p>
    <p class="text-small text-muted-foreground">
      Files and search work as usual. Changes, commits, branches and worktrees need a Git repository in this folder.
    </p>
  </div>
{:else if row !== null}
  <header class="flex h-8 shrink-0 items-center gap-1 border-b pr-1.5 pl-2" data-checkout-head>
    {#if onBoard !== undefined}
      <Tooltip text="All worktrees">
        <button
          type="button"
          class="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          aria-label="All worktrees"
          onclick={onBoard}
          data-checkout-board
        >
          <LayoutList class="size-3.5" />
        </button>
      </Tooltip>
    {/if}
    <DropdownMenu>
      <DropdownMenuTrigger
        class="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-ui font-medium transition-colors hover:bg-hover data-[state=open]:bg-selected"
        aria-label="Branch {head}: compare with"
      >
        <GitBranch class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="min-w-0 truncate">{head}</span>
        <ChevronDown class="size-3 shrink-0 text-muted-foreground/60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="max-h-96 min-w-56 overflow-y-auto">
        <DropdownMenuGroup>
          <DropdownMenuGroupHeading>Compare with</DropdownMenuGroupHeading>
          <DropdownMenuRadioGroup value={checkout.base ?? ''} onValueChange={(next) => (checkout.base = next === '' ? null : next)}>
            <DropdownMenuRadioItem value="">{row.upstream ?? 'The branch’s upstream'}</DropdownMenuRadioItem>
            {#each checkout.branches as one (one.branch)}
              <DropdownMenuRadioItem value={one.branch}>{one.branch}</DropdownMenuRadioItem>
            {/each}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    {#if (row.ahead ?? 0) > 0}
      <span class={CHIP} data-checkout-ahead>↑{row.ahead}</span>
    {/if}
    {#if (row.behind ?? 0) > 0}
      <span class={CHIP} data-checkout-behind>↓{row.behind}</span>
    {/if}
    <span class="flex-1"></span>
    {#if lists.threadMode && holdings.lagging && holdings.unread === null}
      <span class="shrink-0 text-small text-muted-foreground/60" data-checkout-holders-updating>updating</span>
    {/if}
    {#if word !== null}
      <button
        type="button"
        class="shrink-0 rounded-sm bg-status-stale/12 px-1.5 py-0.5 text-small text-status-stale transition-colors hover:opacity-80"
        onclick={() => checkout.retry()}
        data-checkout-stale
      >
        {word}
      </button>
    {/if}
    {#if sync !== null}
      {@const Icon = SYNC[sync].icon}
      <Button
        size="sm"
        variant="ghost"
        class="h-6 gap-1 px-1.5 text-small"
        disabled={busy !== null}
        onclick={syncNow}
        data-checkout-sync={sync}
      >
        <Icon class="size-3" />{SYNC[sync].label}
      </Button>
    {/if}
    {#if row.upstream !== null}
      <Tooltip text="Fetch">
        <button
          type="button"
          class="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          aria-label="Fetch"
          disabled={busy !== null}
          onclick={fetchNow}
          data-checkout-fetch
        >
          {#if busy === 'fetch'}<Waiting class="size-3.5" />{:else}<RefreshCw class="size-3.5" />{/if}
        </button>
      </Tooltip>
    {/if}
    <GroupingToggle />
    <ViewMenu extra={groupingExtra} />
  </header>

  {#if row.unresolvedBase !== null}
    <p class="shrink-0 truncate border-b px-3 py-1 text-small text-destructive" data-checkout-unresolved-base>
      {row.unresolvedBase} — no such revision here
    </p>
  {:else if checkout.base !== null && row.compare !== null}
    <div class="flex min-w-0 shrink-0 items-center gap-2 border-b px-3 py-1 text-small text-muted-foreground" data-checkout-compare>
      <span class="min-w-0 truncate">vs <span class="text-foreground/85">{row.compare.base}</span></span>
      <span class="ml-auto shrink-0 tabular-nums">{row.compare.entries.length} {row.compare.entries.length === 1 ? 'file' : 'files'}</span>
      <LineCount lines={{ added: row.compare.added, removed: row.compare.removed }} class="shrink-0" />
      <Tooltip text="Stop comparing">
        <button
          type="button"
          class="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground/70 transition-colors hover:bg-hover hover:text-foreground"
          aria-label="Stop comparing"
          onclick={() => (checkout.base = null)}
        >
          <X class="size-3" />
        </button>
      </Tooltip>
    </div>
  {/if}
  <FastStatusOffer projectId={checkout.projectId} slowStatus={row.slowStatus} />
  {#if row.operation !== 'none'}
    <div
      class="flex shrink-0 items-center gap-1.5 border-b bg-destructive/10 px-3 py-1.5 text-small text-destructive"
      data-checkout-operation
    >
      <span class="min-w-0 flex-1 truncate">
        {OPERATION_WORD[row.operation]} in progress{conflicts.length > 0
          ? ` · ${conflicts.length} ${conflicts.length === 1 ? 'conflict' : 'conflicts'}`
          : ''}
      </span>
      {#if conflicts.length > 0}
        <Button size="sm" variant="outline" class="h-6 px-2 text-small" onclick={() => show(conflicts[0]?.path ?? '')}>Resolve</Button>
      {/if}
      <Button size="sm" variant="outline" class="h-6 px-2 text-small" onclick={() => (pending = { act: 'abort' })} data-checkout-abort>
        Abort
      </Button>
    </div>
  {/if}

  <CommitBox
    staged={staged.length}
    editing={lists.editing}
    pushable={pushAim !== null}
    committing={repo.commit.pending}
    formatRefused={flow.refused?.rootId === rootId}
    bind:message={draft}
    onCommit={commit}
    onWithoutFormat={() => {
      if (flow.refused !== null) commitNow(flow.refused.message, flow.refused.amend, flow.refused.aim, true);
    }}
    onEdit={() => (flow.refused = null)}
  />

  <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-1">
    {#if !lists.anything}
      <p class="px-3 py-2 text-ui text-muted-foreground" data-checkout-clean>No changes</p>
    {:else}
      {#if conflicts.length > 0}
        <ChangeSection fold="git-conflicts" title="Conflicts" count={conflicts.length}>
          {#snippet acts()}
            {@render stageAct(pathsOf(conflicts))}
          {/snippet}
          <ChangeList
            items={conflicts}
            grouped={lists.grouped}
            selected={selectedAt(null)}
            onOpen={(entry: CheckoutEntry) => show(entry.path)}
            onKeep={(entry: CheckoutEntry) => show(entry.path, null, null, 'open')}
            acts={conflictActs}
          />
        </ChangeSection>
      {/if}
    {/if}
    {#if lists.anything && lists.threadMode}
      {#each lists.groups as group (group.key)}
        {@const stageable = pathsOf(group.entries.filter((item) => item.unstaged))}
        <ChangeSection fold="git-thread:{group.key}" title={group.name} count={group.entries.length}>
          {#snippet acts()}
            {#if stageable.length > 0}{@render stageAct(stageable)}{/if}
          {/snippet}
          <ChangeList
            items={group.entries}
            grouped={lists.grouped}
            selected={workingPath}
            onOpen={(item: ThreadGroupEntry) => show(item.path, null, sideOf(item))}
            onKeep={(item: ThreadGroupEntry) => show(item.path, null, sideOf(item), 'open')}
            acts={threadActs}
          />
        </ChangeSection>
      {/each}
    {:else if lists.anything}
      {#if staged.length > 0}
        <ChangeSection fold="git-staged" title="Staged" count={staged.length}>
          {#snippet acts()}
            {@render unstageAct(pathsOf(staged))}
          {/snippet}
          <ChangeList
            items={staged}
            grouped={lists.grouped}
            selected={selectedAt('staged')}
            onOpen={(entry: CheckoutEntry) => show(entry.path, null, 'staged')}
            onKeep={(entry: CheckoutEntry) => show(entry.path, null, 'staged', 'open')}
            acts={stagedActs}
          />
        </ChangeSection>
      {/if}
      {#if changes.length > 0}
        <ChangeSection fold="git-changes" title="Changes" count={changes.length}>
          {#snippet acts()}
            {@render discardAct(pathsOf(changes))}
            {@render stageAct(pathsOf(changes))}
          {/snippet}
          <ChangeList
            items={changes}
            grouped={lists.grouped}
            selected={selectedAt('unstaged')}
            onOpen={(entry: CheckoutEntry) => show(entry.path, null, 'unstaged')}
            onKeep={(entry: CheckoutEntry) => show(entry.path, null, 'unstaged', 'open')}
            acts={changeActs}
          />
        </ChangeSection>
      {/if}
    {/if}
    {#if graph.length > 0}
      <ChangeSection fold="git-graph" title="Graph" count={graph.length} shutByDefault actsShown>
        {#snippet acts()}
          <button
            type="button"
            class="rounded-sm px-1.5 py-0.5 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            onclick={() => void act(repo.sync.run(undefined, { throwOnError: true }))}
            data-checkout-graph-sync
          >
            Sync
          </button>
        {/snippet}
        <ChangeList
          items={graph}
          grouped={lists.grouped}
          selected={selectedAt(null)}
          onOpen={(entry: CheckoutEntry) => show(entry.path)}
          onKeep={(entry: CheckoutEntry) => show(entry.path, null, null, 'open')}
        />
      </ChangeSection>
    {/if}
  </div>

  {#if logOpen}
    <SeamHandle seam={logSeam} label="Resize the commits list" />
  {/if}
  <div
    bind:this={dock}
    class={['overflow-y-auto border-t py-1', logOpen ? 'min-h-0' : 'shrink-0']}
    style:height={logOpen ? `${logSeam.size}px` : undefined}
    data-checkout-log
  >
    {#if linked !== null && rootId !== null && !linkedListed}
      <ChangeSection fold="git-linked" title="Commit {linked.slice(0, SHORT_SHA)}">
        <CommitFiles
          projectId={checkout.projectId}
          {rootId}
          commit={linked}
          grouped={lists.grouped}
          selected={openCommit === linked ? (open?.path ?? null) : null}
          onOpen={(file: ComparedPath) => show(file.path, linked)}
          onKeep={(file: ComparedPath) => show(file.path, linked, null, 'open')}
        />
      </ChangeSection>
    {/if}
    <ChangeSection fold="git-commits" title="Commits">
      {#if rootId !== null && log.lines !== null}
        <CommitList
          projectId={checkout.projectId}
          {rootId}
          commits={logLines.map((line) => ({
            sha: line.full,
            subject: line.subject,
            author: line.author,
            date: line.date,
            graph: line.graph,
          }))}
          grouped={lists.grouped}
          selected={open === null || openCommit === null ? null : { commit: openCommit, path: open.path }}
          opened={linked}
          foldGraph
          onOpen={(sha: string, file: ComparedPath) => show(file.path, sha)}
          onKeep={(sha: string, file: ComparedPath) => show(file.path, sha, null, 'open')}
        />
        {#if log.more}
          <button
            type="button"
            class="flex h-6 w-full items-center rounded-md text-left text-small text-muted-foreground/70 transition-colors hover:bg-hover hover:text-foreground"
            style:padding-left="{insetOf(0)}px"
            onclick={() => log.askMore()}
          >
            Show more
          </button>
        {/if}
      {:else}
        <div class="grid gap-2 px-3 py-1" aria-busy="true">
          <span class="block h-2 w-3/5 animate-pulse rounded-sm bg-selected"></span>
          <span class="block h-2 w-2/5 animate-pulse rounded-sm bg-selected"></span>
        </div>
      {/if}
    </ChangeSection>
  </div>
{/if}

<Dialog
  open={pending !== null}
  onOpenChange={(next) => {
    if (!next) pending = null;
  }}
>
  <DialogContent class="sm:max-w-md">
    {#if pending !== null && row !== null}
      {@const asked = askedOf(pending, row)}
      <DialogHeader>
        <DialogTitle class="text-ui">{asked.summary}</DialogTitle>
        <DialogDescription class="text-small">{asked.consequence}</DialogDescription>
      </DialogHeader>
      {#if pending.act === 'discard'}
        <ul class="grid max-h-60 gap-0.5 overflow-y-auto font-mono text-small text-muted-foreground">
          {#each pending.paths as path (path)}
            <li><PathText {path} /></li>
          {/each}
        </ul>
      {/if}
      <DialogFooter class="gap-2">
        <Button variant="outline" data-runlith-autofocus-ignore onclick={() => (pending = null)}>Cancel</Button>
        <Button variant={asked.intent === 'destructive' ? 'destructive' : 'default'} onclick={confirm}>
          {asked.confirmLabel}
        </Button>
      </DialogFooter>
    {/if}
  </DialogContent>
</Dialog>
