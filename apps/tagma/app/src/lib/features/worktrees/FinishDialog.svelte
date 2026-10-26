<script lang="ts">
  import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
  import Check from '@lucide/svelte/icons/check';
  import CircleDashed from '@lucide/svelte/icons/circle-dashed';
  import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import type { MergeReading } from '@tagma/server/landing/contract/wire/merge';
  import type { RenameRemote } from '@tagma/server/worktrees/contract/wire/creation';
  import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
  import type { MergeMode } from '@tagma/server/worktrees/contract/wire/mergeTypes';
  import { untrack } from 'svelte';
  import { CHECKOUT_DIRECTORY } from '@tagma/server/graph/contract/wire/storage';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import { Textarea } from '$lib/shared/ui/textarea/index.js';
  import { Live } from '$lib/wire/Live.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
  import { HoldingsReading } from './HoldingsReading.svelte.js';
  import { BaseReading, baseName, baseOf } from './BaseReading.svelte.js';
  import { Finishing, waitsForBase } from './Finishing.svelte.js';
  import type { MergeAfter } from '@tagma/server/worktrees/contract/wire/mergeTypes';
  import { graphChangeWords } from './finishWords.js';
  import FinishOutcome from './FinishOutcome.svelte';
  import { stands } from './PlaceStanding.js';
  import StandingList from './StandingList.svelte';
  import { Worktrees } from './BoardState.svelte.js';
  import WorktreeNameField from './WorktreeNameField.svelte';
  import WorktreeSwatch from './WorktreeSwatch.svelte';
  import { holderName } from './holders.js';

  const finishing = Finishing.use();
  const worktrees = Worktrees.use();
  const window = worktrees.window();
  const live = Live.use();
  const projectId = worktrees.aim.projectId;
  const workspace = Workspace.use();
  const project = $derived(workspace.find(projectId)?.name ?? String(projectId));

  const view = $derived(finishing.view);
  const snapshot = $derived(view?.row ?? null);
  const row = $derived(snapshot === null ? null : (worktrees.byRoot(snapshot.rootId) ?? snapshot));
  const branch = $derived(row?.branch ?? row?.name ?? '');
  const facts = $derived(row === null ? null : window.rowOf(row.rootId));
  const into = $derived(baseName(row));

  const MODES: readonly { readonly mode: MergeMode; readonly label: string }[] = [
    { mode: 'merge', label: 'Merge commit' },
    { mode: 'squash', label: 'Squash' },
    { mode: 'rebase', label: 'Rebase' },
  ];

  let mode = $state<MergeMode>('merge');
  let message = $state('');
  let remove = $state(true);
  let reading = $state<MergeReading | null>(null);
  let checkFailed = $state(false);

  const tree = new BaseReading(live, projectId);
  const base = new BaseReading(live, projectId);
  const baseHoldings = new HoldingsReading(live, projectId);
  const names = ThreadNames.use();
  $effect(() => () => {
    tree.close();
    base.close();
    baseHoldings.close();
  });

  const merging = $derived(view?.kind === 'merge' ? view.row.rootId : null);
  const baseRow = $derived<WorktreePlace | null>(row === null ? null : finishing.baseRowOf(row));

  $effect(() => {
    const rootId = merging;
    untrack(() => {
      reading = null;
      checkFailed = false;
      if (rootId === null) {
        tree.aim(null, null);
        base.aim(null, null);
        return;
      }
      mode = 'merge';
      message = '';
      remove = true;
      tree.aim(rootId, baseOf(snapshot));
    });
  });

  const tips = $derived(merging === null || row === null ? null : `${merging}:${row.head}:${row.base?.commit}`);

  $effect(() => {
    const rootId = merging;
    if (tips === null || rootId === null) return;
    untrack(() => {
      void finishing.check(rootId).then((answer) => {
        if (merging !== rootId) return;
        reading = answer;
        checkFailed = answer === null;
      });
    });
  });

  $effect(() => {
    const rootId = merging === null ? null : (baseRow?.rootId ?? null);
    untrack(() => {
      base.aim(rootId, null);
      baseHoldings.aim(rootId === null ? null : { root: rootId });
    });
  });

  const inGraphTree = (entry: { readonly path: string }): boolean =>
    entry.path === CHECKOUT_DIRECTORY || entry.path.startsWith(`${CHECKOUT_DIRECTORY}/`);

  const writes = $derived(tree.row?.compare?.entries ?? null);
  const codeWrites = $derived(writes?.filter((entry) => !inGraphTree(entry)) ?? []);
  const graphLine = $derived(checkFailed ? 'not read' : graphChangeWords(reading?.graph ?? null));
  const touched = $derived(new Set(writes?.map((entry) => entry.path) ?? []));
  const summary = $derived(
    [
      (facts?.ahead ?? 0) > 0 ? `${facts?.ahead} ${facts?.ahead === 1 ? 'commit' : 'commits'}` : null,
      `${codeWrites.length} ${codeWrites.length === 1 ? 'file' : 'files'}`,
    ]
      .filter((part) => part !== null)
      .join(' · '),
  );
  const lines = $derived.by(() => {
    const compared = tree.row?.compare;
    return compared == null || (compared.added === 0 && compared.removed === 0)
      ? null
      : { added: compared.added, removed: compared.removed };
  });

  const busyAgents = $derived(row === null ? 0 : row.agents.working + row.agents.waiting);
  const uncommitted = $derived(facts?.stateFact.state === 'current' ? facts.uncommitted : null);

  type Blocker = { readonly ok: boolean | null; readonly text: string; readonly hard: boolean };

  const baseState = $derived.by(() => {
    const state = base.row;
    if (state === null) return null;
    const staged = state.entries.staged.entries.length;
    const dirty = [...state.entries.unstaged.entries, ...state.entries.untracked.entries].filter((entry) => touched.has(entry.path));
    const handsOf = (path: string): readonly string[] => {
      const verdict = baseHoldings.of(path)?.verdict;
      return verdict?.verdict === 'proven'
        ? verdict.hands.filter((hand) => !hand.retired).map((hand) => holderName(hand.holder, (thread) => names.of(thread)?.label ?? null))
        : [];
    };
    const held = dirty.filter((entry) => handsOf(entry.path).length > 0);
    const holders = [...new Set(held.flatMap((entry) => handsOf(entry.path)))];
    return { operation: state.operation, staged, held, holders, unclaimed: dirty.filter((entry) => !held.includes(entry)) };
  });

  const blockers = $derived.by<readonly Blocker[]>(() => {
    if (row === null) return [];
    const list: Blocker[] = [];
    list.push(
      busyAgents === 0
        ? { ok: true, hard: false, text: `No agent is working in ${branch}` }
        : {
            ok: false,
            hard: false,
            text: `${busyAgents} ${busyAgents === 1 ? 'agent is' : 'agents are'} still working in ${branch}; the merge takes what is committed now`,
          },
    );
    list.push(
      uncommitted === null
        ? {
            ok: null,
            hard: false,
            text: `Uncommitted state: ${facts?.stateFact.state ?? 'not taken'}${window.unread === null ? '' : ` — ${window.unread}`}`,
          }
        : uncommitted === 0
          ? { ok: true, hard: false, text: 'Nothing uncommitted in the worktree' }
          : {
              ok: false,
              hard: false,
              text: `${uncommitted} ${uncommitted === 1 ? 'path holds' : 'paths hold'} uncommitted lines in the worktree; they stay out of the merge`,
            },
    );
    if (reading === null) list.push({ ok: null, hard: false, text: `Checking the merge into ${into}…` });
    else if (reading.check === 'clean') {
      list.push({
        ok: true,
        hard: false,
        text: `Merges cleanly into ${into}${reading.base === null ? '' : ` @ ${reading.base.tip.slice(0, 7)}`}`,
      });
    } else if (reading.check === 'conflicts') {
      list.push({
        ok: false,
        hard: true,
        text: `Conflicts with ${into} in ${reading.conflicts.length} ${reading.conflicts.length === 1 ? 'file' : 'files'}: ${reading.conflicts.slice(0, 4).join(', ')}${reading.conflicts.length > 4 ? '…' : ''}`,
      });
    } else if (reading.check === 'format-behind') {
      list.push({ ok: null, hard: false, text: reading.reason ?? 'Branch format is being brought forward before the merge check' });
    } else list.push({ ok: null, hard: false, text: reading.reason ?? 'The merge check could not be taken' });
    const standing = baseState;
    if (baseRow === null)
      list.push({ ok: null, hard: false, text: `No checkout of ${into} is listed; the server reads it when the merge runs` });
    else if (standing === null) list.push({ ok: null, hard: false, text: `Reading ${into}…` });
    else if (standing.operation !== 'none')
      list.push({ ok: false, hard: false, text: `${into} is in the middle of a ${standing.operation}` });
    else if (standing.staged > 0)
      list.push({
        ok: false,
        hard: false,
        text: `${into} holds ${standing.staged} staged ${standing.staged === 1 ? 'entry' : 'entries'} a merge there would carry`,
      });
    else if (standing.held.length > 0) {
      list.push({
        ok: false,
        hard: false,
        text: `${into} holds uncommitted lines in ${standing.held
          .slice(0, 3)
          .map((entry) => entry.path.split('/').at(-1))
          .join(
            ', ',
          )} — held by ${standing.holders.join(', ')}. The merge touches ${standing.held.length === 1 ? 'that file' : 'those files'} and waits until they are committed.`,
      });
    } else if (standing.unclaimed.length > 0) {
      list.push({
        ok: false,
        hard: true,
        text: `${into} holds changes nobody's record claims on ${standing.unclaimed
          .slice(0, 3)
          .map((entry) => entry.path)
          .join(', ')}, which the merge writes`,
      });
    } else list.push({ ok: true, hard: false, text: `${into} holds nothing on the paths this merge writes` });
    return list;
  });

  const refusal = $derived(snapshot === null ? null : (finishing.refusals.get(snapshot.rootId) ?? null));
  const acting = $derived(snapshot === null ? null : finishing.actingOn(snapshot.rootId));
  const hardBlocked = $derived(blockers.some((one) => one.hard && one.ok === false));
  const baseBusy = $derived(
    waitsForBase(refusal) || (baseState !== null && (baseState.operation !== 'none' || baseState.staged > 0 || baseState.held.length > 0)),
  );
  const after = $derived<MergeAfter>(remove ? 'delete' : 'keep');
  const standingThreads = $derived(row?.agents.standing ?? 0);
  const running = $derived(snapshot === null ? null : finishing.standingIn(snapshot.rootId));
  const ends = $derived(running !== null && stands(running));

  function submit(): void {
    if (snapshot === null || row === null) return;
    const ask = { mode, after, whenBaseFree: baseBusy, message: message.trim() === '' || mode === 'rebase' ? undefined : message.trim() };
    void finishing.merge(row, ask);
  }

  const renaming = $derived(view?.kind === 'rename' ? view.row.rootId : null);
  let renameTo = $state('');
  let keepOrMove = $state<RenameRemote>('keep');

  $effect(() => {
    const rootId = renaming;
    untrack(() => {
      if (rootId === null) return;
      renameTo = snapshot?.branch ?? '';
      keepOrMove = 'keep';
    });
  });

  const REMOTE_CHOICES: readonly { readonly value: RenameRemote; readonly label: string }[] = [
    { value: 'keep', label: 'Keep it open on the old name' },
    { value: 'move', label: 'Open a new one under the new name and close the old' },
  ];

  function rename(): void {
    if (row === null || renameTo.trim() === '') return;
    void finishing.rename(row, renameTo, keepOrMove);
  }

  const LABEL = 'text-small font-medium text-muted-foreground';
</script>

{#snippet mark(ok: boolean | null)}
  {#if ok === true}
    <Check class="mt-0.5 size-3.5 shrink-0 text-status-done" />
  {:else if ok === false}
    <AlertTriangle class="mt-0.5 size-3.5 shrink-0 text-status-stale" />
  {:else}
    <CircleDashed class="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
  {/if}
{/snippet}

<Dialog.Root
  open={view !== null}
  onOpenChange={(next) => {
    if (!next) finishing.close();
  }}
>
  <Dialog.Content class="sm:max-w-lg" data-finish-dialog={view?.kind}>
    {#if view !== null && row !== null}
      {#if view.kind === 'merge'}
        <Dialog.Header>
          <Dialog.Title class="flex min-w-0 items-center gap-2 text-page">
            <WorktreeSwatch {row} size="md" />
            <span class="min-w-0" {@attach window.observe(row.rootId)}
              >Merge <span class="font-mono text-ui">{branch}</span> into {into}</span
            >
          </Dialog.Title>
          <Dialog.Description class="tabular-nums">
            {summary}
            {#if lines !== null}
              · {#if lines.added > 0}<span class="text-status-done">+{lines.added}</span>{/if}
              {#if lines.removed > 0}<span class="text-destructive/80">−{lines.removed}</span>{/if}
            {/if}
            · graph: <span data-merge-graph={reading?.graph.status ?? 'reading'}>{graphLine ?? 'reading…'}</span>
          </Dialog.Description>
          <p class="break-all text-small text-muted-foreground">Project: {project} · {row.folder}</p>
          {#if baseRow !== null}<p class="break-all text-small text-muted-foreground">Into: {baseRow.folder}</p>{/if}
        </Dialog.Header>

        <div class="grid gap-4">
          <div class="grid gap-1.5">
            <span class={LABEL}>How</span>
            <div class="flex w-fit gap-0.5 rounded-lg bg-hover p-0.5" role="group" aria-label="How to merge">
              {#each MODES as choice (choice.mode)}
                <button
                  type="button"
                  aria-pressed={mode === choice.mode}
                  class={[
                    'h-6 rounded-md px-3 text-small transition-colors',
                    mode === choice.mode ? 'bg-selected text-foreground' : 'text-muted-foreground hover:text-foreground',
                  ]}
                  onclick={() => (mode = choice.mode)}
                  data-merge-mode={choice.mode}
                >
                  {choice.label}
                </button>
              {/each}
            </div>
          </div>

          {#if mode !== 'rebase'}
            <label class="grid gap-1.5">
              <span class={LABEL}>Message</span>
              <Textarea
                bind:value={message}
                rows={2}
                class="min-h-0 resize-none text-ui"
                placeholder="Left empty, it names the worktree, its branch and its base"
              />
            </label>
          {/if}

          <div class="grid gap-1.5" data-merge-blockers>
            <span class={LABEL}>Before it runs</span>
            {#each blockers as blocker, index (index)}
              <div class="grid grid-cols-[14px_minmax(0,1fr)] gap-2 text-ui leading-snug">
                {@render mark(blocker.ok)}
                <span class={blocker.ok === false ? 'text-foreground' : 'text-muted-foreground'}>{blocker.text}</span>
              </div>
            {/each}
            {#if reading?.check === 'conflicts'}
              <Button
                variant="outline"
                size="sm"
                class="mt-1 h-7 w-fit text-small"
                onclick={() => {
                  if (row !== null) void finishing.update(row);
                }}
              >
                Update from {into}
              </Button>
            {/if}
          </div>

          <div class="grid gap-1.5">
            <span class={LABEL}>After</span>
            <label class="flex items-center gap-2 text-ui">
              <input type="checkbox" class="size-3.5 accent-(--color-brand)" bind:checked={remove} />
              Delete the worktree{standingThreads > 0
                ? ` and archive its ${standingThreads} ${standingThreads === 1 ? 'thread' : 'threads'}`
                : ''}
            </label>
            {#if after !== 'keep' && running !== null && ends}
              <StandingList standing={running} lead="Deleting ends what still runs here" />
            {/if}
          </div>

          {#if refusal !== null}
            <div class="grid gap-1 rounded-md bg-destructive/8 px-3 py-2 text-small" data-merge-refusal={refusal.code}>
              <span class="text-destructive">{refusal.reason}</span>
              {#each refusal.unblock as way (way)}
                <span class="text-muted-foreground">{way}</span>
              {/each}
            </div>
          {/if}
        </div>

        <Dialog.Footer class="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            class="sm:mr-auto"
            disabled={acting !== null}
            onclick={() => {
              if (row !== null) void finishing.pullRequest(row);
            }}
          >
            <GitPullRequest class="size-3.5" />
            Open a PR instead
          </Button>
          <div class="flex gap-2">
            <Button variant="outline" data-runlith-autofocus-ignore onclick={() => finishing.close()}>Cancel</Button>
            <Button disabled={hardBlocked || acting !== null} onclick={submit} data-merge-submit={baseBusy ? 'wait' : 'merge'}>
              {#if acting !== null}<Waiting class="size-3.5" />{/if}
              {acting === 'merge' ? 'Merging…' : acting === 'delete' ? 'Deleting…' : baseBusy ? `Merge when ${into} is free` : 'Merge'}
            </Button>
          </div>
        </Dialog.Footer>
      {:else if view.kind === 'rename'}
        <Dialog.Header>
          <Dialog.Title class="flex min-w-0 items-center gap-2 text-page">
            <WorktreeSwatch {row} size="md" />
            <span class="min-w-0" {@attach window.observe(row.rootId)}>Rename <span class="font-mono text-ui">{branch}</span></span>
          </Dialog.Title>
          <Dialog.Description>
            The branch and its graph are renamed; the folder keeps its name. A pushed branch with no open pull request moves to the new name
            on its remote.
          </Dialog.Description>
          <p class="break-all text-small text-muted-foreground">Project: {project} · {row.folder}</p>
        </Dialog.Header>
        <form
          class="grid gap-4"
          onsubmit={(event) => {
            event.preventDefault();
            rename();
          }}
        >
          <div class="grid gap-1.5">
            <span class={LABEL}>New name</span>
            <WorktreeNameField bind:value={renameTo} placeholder={branch} />
          </div>
          <div class="grid gap-1.5" role="radiogroup" aria-label="An open pull request">
            <span class={LABEL}>If a pull request is open on GitHub</span>
            {#each REMOTE_CHOICES as choice (choice.value)}
              <label class="flex items-center gap-2 text-ui">
                <input
                  type="radio"
                  name="rename-remote"
                  class="size-3.5 accent-(--color-brand)"
                  value={choice.value}
                  bind:group={keepOrMove}
                />
                {choice.label}
              </label>
            {/each}
          </div>
          {#if refusal !== null}
            <div class="grid gap-1 rounded-md bg-destructive/8 px-3 py-2 text-small" data-rename-refusal={refusal.code}>
              <span class="text-destructive">{refusal.reason}</span>
              {#each refusal.unblock as way (way)}
                <span class="text-muted-foreground">{way}</span>
              {/each}
            </div>
          {/if}
          <Dialog.Footer class="gap-2">
            <Button type="button" variant="outline" data-runlith-autofocus-ignore onclick={() => finishing.close()}>Cancel</Button>
            <Button type="submit" disabled={renameTo.trim() === '' || acting !== null}>
              {#if acting !== null}<Waiting class="size-3.5" />{/if}
              {acting === 'rename' ? 'Renaming…' : 'Rename'}
            </Button>
          </Dialog.Footer>
        </form>
      {:else}
        <FinishOutcome {view} />
      {/if}
    {/if}
  </Dialog.Content>
</Dialog.Root>
