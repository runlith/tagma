<script module lang="ts">
  import { isQuiet, type ThreadTreeNode } from './forest.js';

  function tokens(value: number): string {
    if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1))}M`;
    if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
    return String(value);
  }

  function finishedBelow(children: readonly ThreadTreeNode[]): number {
    let count = 0;
    for (const child of children) {
      const ending = child.row.outcome?.status;
      if (ending !== undefined && ending !== 'failed' && isQuiet(child)) count += 1;
      count += finishedBelow(child.children);
    }
    return count;
  }

  function agentsBelow(children: readonly ThreadTreeNode[]): number {
    return children.reduce((count, child) => count + 1 + agentsBelow(child.children), 0);
  }
</script>

<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import ChangesIcon from '$lib/features/checkout/ChangesIcon.svelte';
  import PathText from '$lib/shared/PathText.svelte';
  import { ThreadRung } from '$lib/features/workspace/ThreadRung.js';
  import { ThreadChanges, entriesIn } from '$lib/features/checkout/ThreadChanges.svelte.js';
  import { heldWords, unprovenWords } from '$lib/features/checkout/holdingWords.js';
  import { changesPane } from '$lib/features/checkout/paneContent.js';
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
  import Terminal from '@lucide/svelte/icons/terminal';
  import Users from '@lucide/svelte/icons/users';
  import type { ThreadAskOption } from '@tagma/server/threads/contract/wire/list';
  import { ThreadChats } from './ThreadChats.js';
  import { ThreadsRepo } from './Repo.js';
  import { Favorites } from './Favorites.svelte.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { Refusal } from '$lib/wire/refusal.js';
  import { stopFailure } from '@runlith/chat-ui/session/TurnCommands.svelte';
  import type { Draft } from './Draft.svelte.js';
  import { chatNotice } from './notices.js';
  import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
  import { untrack } from 'svelte';
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import HarnessMark from './native/HarnessMark.svelte';
  import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { NOT_INSTALLED } from '$lib/features/providers/served.js';
  import { CommandActivity, silenceOf, type CommandView } from '$lib/features/executions/commands/Activity.svelte.js';
  import WorktreeSwatch from '$lib/features/worktrees/WorktreeSwatch.svelte';
  import ProjectMark from '$lib/features/workspace/ProjectMark.svelte';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import { activityRows, isRunning, linksOf } from './activityRows.js';
  import BlockRefText from './BlockRefText.svelte';
  import MarkdownBody from '$lib/features/graph/MarkdownBody.svelte';
  import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
  import { CommitLinks } from '$lib/features/checkout/CommitLinks.svelte.js';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
  import { CallActivity } from './CallActivity.svelte.js';
  import ContextRing from './native/ContextRing.svelte';
  import type { ThreadSlot } from './ThreadSlot.svelte.js';
  import { stoppableOf } from './rowKind.js';
  import { harnessWords, modelWords } from './native/modelWords.js';
  import ThreadLife, { threadMark } from './Life.svelte';
  import { ThreadList } from './List.svelte.js';
  import { detachWithUndo } from './detach.js';
  import { threadPeeks } from './threadPeek.svelte.js';
  import { warmthAt, warmthWords } from './warmthWords.js';
  import type { CompactionChoice, CompactionChoicesRead } from '@tagma/server/native-harness/contract/wire/compactionChoices';
  import QuotaHeading from '$lib/features/providers/usage/QuotaHeading.svelte';
  import ModelCatalogList from '$lib/features/providers/models/CatalogList.svelte';
  import { choiceKey, type ModelChoice } from '$lib/shared/models/choice.js';
  import { compactionDetail, compactionList, pickedSummarizer } from './native/compactionWords.js';
  import { recapAge } from './native/recap.js';

  const LARGE_TOKENS = 200_000;
  const LARGE_SHARE = 0.5;

  let {
    node,
    peekKey,
    anchor,
    label,
    time,
    processes,
    host = null,
  }: {
    node: ThreadTreeNode;
    peekKey: string;
    host?: ThreadSlot | null;
    anchor: HTMLElement;
    label: string;
    time: string;
    processes: CommandView;
  } = $props();

  const app = App.current();
  const notices = Notices.use();
  const shell = shellActs(ShellOps.use(), notices);
  const list = ThreadList.use();
  const wallClock = WallClock.use();
  const accounts = UsageAccounts.use();
  const catalog = ProviderCatalog.use();
  const calls = CallActivity.use();
  const commands = CommandActivity.use();
  const blockTitles = BlockTitles.use();
  const commitLinks = CommitLinks.use();
  const names = ThreadNames.use();

  const row = $derived(node.row);
  const homed = $derived(host === null || row.projectId === host.projectId);
  let changes = $state.raw<ThreadChanges | null>(null);
  $effect(() => {
    if (row.held.unproven === 0 || !homed) {
      changes = null;
      return;
    }
    const held = app.hold(ThreadRung, { id: row.id });
    changes = app.resolve(ThreadChanges, held.scope);
    return () => held.release();
  });
  const unproven = $derived(
    changes?.checkouts.flatMap((checkout) => entriesIn(checkout, 'unproven').map((entry) => ({ checkout, entry }))) ?? [],
  );

  async function openPath(rootId: RootId, path: string): Promise<void> {
    const held = app.hold(ThreadRung, { id: row.id });
    try {
      await shell.openThread({ projectId: row.projectId, threadId: row.id }, 'main');
      const opened = app.resolve(ThreadChanges, held.scope);
      opened.open = { projectId: opened.projectOf(rootId), rootId, path, commit: null };
      app.resolve(SidePanes).open(changesPane);
      threadPeeks.close(peekKey);
    } catch (error) {
      notices.refusal(error);
    } finally {
      held.release();
    }
  }

  const mark = $derived(threadMark(row));
  const place = $derived(host === null ? null : host.places.placeOf(row.id));
  const harness = $derived(row.harness === null ? null : harnessWords(catalog.models, row.harness));
  const words = $derived(modelWords(catalog.models, row));
  const model = $derived(
    harness === null
      ? [words.model.label, words.rung?.label].filter(Boolean).join(' · ')
      : [harness.label, harness.short, harness.effort.value?.toLowerCase()].filter(Boolean).join(' · '),
  );
  const account = $derived(
    harness !== null
      ? null
      : catalog.installed(words.provider) === false
        ? `${words.providerLabel} · ${NOT_INSTALLED}`
        : row.account === null
          ? `${words.providerLabel} · default account`
          : `${words.providerLabel} · ${accounts.rows.find((entry) => String(entry.account) === row.account)?.label ?? row.account}`,
  );
  const context = $derived.by(() => {
    if (row.contextShare === null) return null;
    const percent = `${Math.round(row.contextShare * 100)}%`;
    const limit = row.contextTokens?.limit ?? null;
    const figure =
      row.contextTokens == null || limit === null
        ? null
        : limit.compaction === null
          ? `${tokens(row.contextTokens.used)} of ${tokens(limit.window)}`
          : `${tokens(row.contextTokens.used)} of ${tokens(limit.compaction.at)} before compaction · window ${tokens(limit.window)}`;
    return [row.phase?.phase === 'compacting' ? 'compacting' : null, percent, figure].filter(Boolean).join(' · ');
  });
  const cache = $derived(row.cacheWarmth === null ? null : warmthWords(row.cacheWarmth, catalog.name(row.provider), () => wallClock.now));

  const recap = $derived(row.recap?.status === 'current' ? row.recap : null);

  const threadCalls = $derived(calls.callsOf(row.id));
  const links = $derived(linksOf(threadCalls));
  const lines = $derived(processes.joined(links));
  const activity = $derived(activityRows(row.id, threadCalls, lines));
  const running = $derived(
    activity.flatMap((entry) => entry.executions.filter(({ line }) => line !== null && isRunning(line)).map(({ label }) => label)),
  );
  const unknown = $derived(activity.filter((entry) => entry.state === 'unknown').length);
  const recent = $derived(activity.filter((entry) => entry.state === 'recent').length);
  const warning = $derived(
    calls.failure ??
      silenceOf(commands.readingFor(activity.flatMap((entry) => entry.executions.flatMap(({ line }) => (line === null ? [] : [line]))))),
  );

  const team = $derived.by(() => {
    if (node.children.length === 0) return null;
    const parts = [
      `${agentsBelow(node.children)} agents`,
      node.team.working > 0 ? `${node.team.working} working` : null,
      node.team.asking > 0 ? `${node.team.asking} asking` : null,
      node.team.failed > 0 ? `${node.team.failed} failed` : null,
    ];
    const finished = finishedBelow(node.children);
    return [...parts, finished > 0 ? `${finished} finished` : null].filter(Boolean).join(' · ');
  });

  type Act = {
    readonly key: string;
    readonly label: string;
    readonly run: () => Promise<void>;
    readonly busy: boolean;
    readonly primary?: boolean;
  };

  function act(key: string, run: () => Promise<void>): Promise<void> {
    return threadPeeks.act(row.id, key, async () => {
      try {
        await run();
      } catch (error) {
        notices.refusal(error);
      }
    });
  }

  const chats = ThreadChats.use();
  const favorites = Favorites.use();
  const threadsRepo = ThreadsRepo.use();

  async function answer(questionId: string, option: ThreadAskOption): Promise<void> {
    const result = await chats.answerQuestion(row.projectId, row.id, questionId, option.answers);
    if (result.status === 'failed') throw new Error(result.message);
  }

  async function continueRun(): Promise<void> {
    const result = await chats.continue(row.projectId, row.id);
    if (result.status === 'failed') throw new Error(result.message);
  }

  async function stop(): Promise<void> {
    const runId = stoppableOf(row);
    if (runId === null) return;
    const failure = stopFailure<Draft>(await chats.stop(row.projectId, row.id, runId));
    if (failure === null) return;
    const text = chatNotice(failure).message;
    throw new Refusal({ gate: false, code: failure.kind, reason: text, unblock: [], words: { text } });
  }

  const compactable = $derived(
    host !== null &&
      row.capabilities.compaction !== 'none' &&
      row.archivedAt === null &&
      mark.state !== 'working' &&
      mark.state !== 'waiting' &&
      row.cacheWarmth !== null &&
      warmthAt(row.cacheWarmth, () => wallClock.now) === 'cold' &&
      ((row.contextTokens?.used ?? 0) >= LARGE_TOKENS || (row.contextShare ?? 0) >= LARGE_SHARE),
  );
  const choicesBasis = $derived(
    compactable
      ? [row.id, row.provider, row.model, row.account, row.reasoning, row.cacheWarmth?.invalidatedBy, row.contextTokens?.used].join('|')
      : null,
  );
  let choices = $state.raw<CompactionChoicesRead | null>(null);
  let choosing = $state(false);

  $effect(() => {
    const basis = choicesBasis;
    const threadId = untrack(() => row.id);
    if (basis === null || host === null) return;
    let current = true;
    const asking = untrack(() => row.projectId);
    untrack(() =>
      threadsRepo.compactionChoices
        .run({ id: threadId, projectId: asking }, { throwOnError: true })
        .then((read) => {
          if (current && read !== undefined) choices = read;
        })
        .catch(() => {
          if (current) choices = null;
        }),
    );
    return () => {
      current = false;
    };
  });

  async function compactWith(chosen: CompactionChoice | null): Promise<void> {
    const result = await chats.compact(
      row.projectId,
      row.id,
      chosen === null ? {} : { summarizer: { provider: chosen.provider, model: chosen.model, reasoning: chosen.reasoning } },
    );
    if (result.status === 'failed') throw new Error(result.message);
  }

  const acts = $derived.by<readonly Act[]>(() => {
    const rowBusy = threadPeeks.busy(row.id);
    const mine = (key: string, words: string, run: () => Promise<void>): Act => ({
      key,
      label: words,
      run: () => act(key, run),
      busy: rowBusy,
    });
    if (row.archivedAt !== null) {
      return [
        {
          key: 'unarchive',
          label: 'Unarchive',
          run: async () => void (await list.setArchived(row.id, false)),
          busy: list.busy(row.id, 'archive'),
        },
      ];
    }
    if (mark.state === 'waiting') {
      const ask = row.ask;
      if (ask == null) return [];
      return ask.options.map((option, index) => ({
        ...mine(`answer:${index}`, option.label, () => answer(ask.questionId, option)),
        primary: index === 0,
      }));
    }
    if (mark.state === 'failed' || mark.state === 'cut') return [{ ...mine('continue', 'Continue', continueRun), primary: true }];
    if (mark.state === 'working') {
      const runId = stoppableOf(row);
      if (runId === null) return [];
      const phase = chats.of(row.projectId).stops.phase(row.id, runId);
      if (phase === null) return [mine('stop', 'Stop', stop)];
      return [{ key: 'stop', label: phase === 'stopping' ? 'Stopping…' : 'Being stopped', run: () => Promise.resolve(), busy: true }];
    }
    const pinning: Act[] = [
      {
        key: 'pin',
        label: row.pinnedAt === null ? 'Pin' : 'Unpin',
        run: () => list.setPinned(row.id, row.pinnedAt === null),
        busy: list.busy(row.id, 'pin'),
      },
    ];
    const read = compactable ? choices : null;
    const own = read?.own ?? null;
    const compacting: Act[] =
      read === null
        ? []
        : [
            ...(read.resolved.choice === null
              ? own === null
                ? []
                : [{ ...mine('compact', `Compact with ${own.label}`, () => compactWith(own)), busy: rowBusy || !own.spendable }]
              : [mine('compact', `Compact · ${read.resolved.choice.label}`, () => compactWith(null))]),
            { key: 'compact-other', label: 'Another model…', run: async () => void (choosing = !choosing), busy: rowBusy },
          ];
    const detaching: Act[] =
      row.parentThreadId === null
        ? []
        : [{ key: 'detach', label: 'Detach', run: () => detachWithUndo(list, notices, row), busy: list.busy(row.id, 'detach') }];
    return [
      ...compacting,
      ...pinning,
      ...detaching,
      {
        key: 'archive',
        label: 'Archive',
        run: async () => void (await list.setArchived(row.id, true)),
        busy: list.busy(row.id, 'archive'),
      },
    ];
  });

  let panel = $state<HTMLDivElement | null>(null);
  const byKey = untrack(() => threadPeeks.keyed === peekKey);

  $effect(() => processes.watch());
  $effect(() => wallClock.watch());

  function onPanelKey(event: KeyboardEvent): void {
    if (event.key !== ' ' || event.target !== panel) return;
    event.preventDefault();
    threadPeeks.close(peekKey);
  }
</script>

<Popover.Root
  open
  onOpenChange={(next) => {
    if (!next) threadPeeks.close(peekKey);
  }}
>
  <Popover.Content
    {anchor}
    side="right"
    align="start"
    sideOffset={8}
    collisionPadding={12}
    trapFocus={false}
    initialFocus={byKey ? () => panel : false}
    returnFocus={() => (byKey || panel?.contains(document.activeElement) ? anchor : null)}
    onpointerenter={() => threadPeeks.hold()}
    onpointerleave={() => threadPeeks.leave(peekKey)}
    onkeydown={onPanelKey}
    class="w-[19rem] max-w-[calc(100vw-1.5rem)] gap-0 p-0"
  >
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      bind:this={panel}
      tabindex="-1"
      role="group"
      aria-label={`${label} — details`}
      class="flex flex-col gap-2 px-3 py-2 text-small outline-none"
      data-thread-peek={row.id}
    >
      <div class="flex min-w-0 flex-col gap-0.5">
        <div class="flex min-w-0 items-center gap-1.5">
          <ThreadLife thread={row} />
          <span class="min-w-0 truncate text-ui font-medium">{label}</span>
        </div>
        <span class="pl-5 text-meta text-muted-foreground">{mark.label} · <span class="tabular">{time}</span></span>
      </div>

      {#if recap !== null}
        <div class="grid gap-1" data-thread-peek-recap>
          <div class="flex min-w-0 items-center gap-2 font-mono text-meta">
            <span class="font-medium text-primary">↳ Recap</span>
            <span class="text-muted-foreground">{recapAge(recap.generatedAt, wallClock.minute)}</span>
          </div>
          <p class="line-clamp-5 text-small leading-relaxed"><BlockRefText text={recap.summary} /></p>
          {#if recap.next !== null}
            <div class="grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-small leading-relaxed">
              <span class="pt-px font-mono text-meta text-muted-foreground">Next</span>
              <span class="line-clamp-3"><BlockRefText text={recap.next} /></span>
            </div>
          {/if}
        </div>
      {:else if row.saidLine}
        <div class="border-l-2 border-border pl-2 text-foreground/75" data-thread-said>
          <MarkdownBody
            text={row.saidLine}
            class="line-clamp-5 text-small leading-relaxed"
            refs={blockTitles}
            commits={commitLinks}
            threadOf={(id) => names.of(id)}
          />
        </div>
      {/if}

      <dl class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-small">
        <dt class="text-muted-foreground">Model</dt>
        <dd class="flex min-w-0 items-center gap-1.5">
          {#if harness === null}
            <ProviderMark provider={words.provider} class="size-3 shrink-0" titled={false} />
          {:else if row.harness !== null}
            <HarnessMark harness={row.harness.name} class="size-3 shrink-0" />
          {/if}
          <span class="min-w-0 truncate" title={account === null ? model : `${model} · ${account}`}>{model}</span>
        </dd>
        {#if account !== null}
          <dt class="text-muted-foreground">Account</dt>
          <dd class="min-w-0 truncate">{account}</dd>
        {/if}
        <dt class="text-muted-foreground">Context</dt>
        <dd class="flex min-w-0 items-center gap-1.5">
          {#if row.contextShare !== null}
            <ContextRing
              share={row.contextShare}
              compacting={row.phase?.phase === 'compacting'}
              warmth={row.cacheWarmth}
              provider={row.provider}
            />
          {/if}
          <span class="tabular">{context ?? 'not measured'}</span>
        </dd>
        <dt class="text-muted-foreground">Prompt cache</dt>
        <dd class="min-w-0 truncate" title={cache ?? undefined}>{cache ?? 'no reading'}</dd>
        {#if row.held.paths > 0 || row.held.unproven > 0}
          <dt class="text-muted-foreground">Uncommitted</dt>
          <dd class="flex min-w-0 flex-col gap-1">
            <span class="flex flex-wrap items-center gap-1">
              <span class="text-muted-foreground"><ChangesIcon unchecked={row.held.unproven > 0} small /></span>{heldWords(
                row.held.paths,
                row.held.unproven,
              )}
            </span>
            {#if row.held.unproven > 0 && homed && !changes?.known}
              <span class="text-small text-muted-foreground">Reading paths and reasons…</span>
            {/if}
            {#each unproven as { checkout, entry } (`${checkout.checkout}:${entry.path}`)}
              <button
                type="button"
                class="flex min-w-0 flex-col gap-0.5 rounded-sm px-1 py-0.5 text-left text-small hover:bg-hover"
                onclick={() => void openPath(checkout.checkout, entry.path)}
                title={`${checkout.root}/${entry.path}`}
              >
                <PathText class="w-full underline" path={entry.path} />
                <span class="break-words text-muted-foreground">{unprovenWords(entry.reason)}</span>
              </button>
            {/each}
          </dd>
        {/if}
        <dt class="text-muted-foreground">Processes</dt>
        <dd class="flex min-w-0 flex-col gap-0.5">
          <span class="flex min-w-0 items-center gap-1">
            <Terminal class={['size-3 shrink-0', running.length > 0 ? 'text-status-in-work' : 'text-muted-foreground']} />
            <span class="min-w-0 truncate">
              {running.length > 0 ? `${running.length} running — ${running.slice(0, 2).join(', ')}` : 'none running'}{unknown > 0
                ? ` · ${unknown} unreadable`
                : ''}{recent > 0 ? ` · ${recent} recent` : ''}
            </span>
          </span>
          {#if warning !== null}<span class="text-status-in-work">Activity may be incomplete. {warning}</span>{/if}
        </dd>
        {#if !homed}
          <dt class="text-muted-foreground">Project</dt>
          <dd class="flex min-w-0 items-center"><ProjectMark projectId={row.projectId} class="min-w-0" /></dd>
        {:else if host !== null && host.places.known}
          <dt class="text-muted-foreground">Worktree</dt>
          <dd class="flex min-w-0 items-center gap-1.5" data-thread-peek-worktree={place?.name ?? ''}>
            {#if place === null}
              <span class="text-muted-foreground">
                {host.places.creatingOf({ id: row.id, name: row.name }) === null ? 'not in a worktree' : 'new worktree · being made'}
              </span>
            {:else}
              <WorktreeSwatch row={place} />
              <span class="min-w-0 truncate font-mono text-meta">{place.branch ?? place.name}</span>
            {/if}
          </dd>
        {/if}
        {#if team !== null}
          <dt class="text-muted-foreground">Team</dt>
          <dd class="flex min-w-0 items-center gap-1">
            <Users class="size-3 shrink-0 text-muted-foreground" /><span class="min-w-0 truncate">{team}</span>
          </dd>
        {/if}
      </dl>

      {#if acts.length > 0}
        <div class="flex flex-wrap items-center gap-1.5">
          {#each acts as entry (entry.key)}
            <Button
              size="xs"
              variant={entry.primary ? 'default' : 'outline'}
              disabled={entry.busy}
              onclick={() => void entry.run()}
              data-peek-act={entry.key}
            >
              {entry.label}
            </Button>
          {/each}
        </div>
      {/if}

      {#if choosing && compactable && choices !== null}
        {@const read = choices}
        {@const listed = compactionList(catalog.models, read, favorites.list, wallClock.now)}
        <div class="-mx-3 -mb-2 border-t border-border" data-peek-choices>
          {#snippet quota(provider: string, label: string)}
            <div class="eyebrow flex min-w-0 items-center gap-1.5 px-2 pt-2 pb-1 text-muted-foreground">
              <QuotaHeading {provider} {label} now={wallClock.now} />
            </div>
          {/snippet}
          {#snippet detail(choice: ModelChoice)}
            {@const chosen = listed.rows.get(choiceKey(choice.provider, choice.model))}
            {chosen === undefined ? '' : compactionDetail(catalog.models, read, chosen, accounts.rows, wallClock.now)}
          {/snippet}
          <ModelCatalogList
            choices={listed.choices}
            lead={listed.lead}
            current={listed.current}
            starred={listed.lead.find((section) => section.id === 'favorites')?.keys ?? []}
            title="Compact with"
            busy={threadPeeks.busy(row.id)}
            heading={quota}
            {detail}
            onpick={(choice, rung) => {
              const picked = pickedSummarizer(read, choice.provider, choice.model, rung);
              choosing = false;
              if (picked !== null) void act('compact', () => compactWith(picked.named));
            }}
            onclose={() => (choosing = false)}
          />
        </div>
      {/if}
    </div>
  </Popover.Content>
</Popover.Root>
