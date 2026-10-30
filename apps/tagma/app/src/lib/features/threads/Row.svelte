<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Pin from '@lucide/svelte/icons/pin';
  import Terminal from '@lucide/svelte/icons/terminal';
  import ChangesIcon from '$lib/features/checkout/ChangesIcon.svelte';
  import { heldWords } from '$lib/features/checkout/holdingWords.js';
  import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
  import type { ThreadSlot } from './ThreadSlot.svelte.js';
  import type { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import { flushSync, untrack, type Snippet } from 'svelte';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { doubleClick } from '$lib/shared/doubleClick.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { CommandActivity } from '$lib/features/executions/commands/Activity.svelte.js';
  import LoadBadge from './LoadBadge.svelte';
  import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import ProjectMark from '$lib/features/workspace/ProjectMark.svelte';
  import ContextRing from './native/ContextRing.svelte';
  import { CONTEXT_RING_HOT } from '@runlith/chat-ui/ContextRing.svelte';
  import ModelPlate from './native/ModelPlate.svelte';
  import MatchText from '$lib/shared/MatchText.svelte';
  import RenameField from './RenameField.svelte';
  import { sameSelection } from './native/modelWords.js';
  import { RowReading } from './rowReading.svelte.js';
  import { WorkLines } from './workLines.svelte.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import AgentCounts from '$lib/shared/ui/AgentCounts.svelte';
  import ThreadLife from './Life.svelte';
  import ThreadPeek from './Peek.svelte';
  import { threadPeeks } from './threadPeek.svelte.js';
  import { STOWED, Stow, type Squeeze } from './squeeze.svelte.js';
  import type { ThreadFolds } from './threadFolds.svelte.js';
  import type { ThreadTreeNode } from './forest.js';
  import { ContextAim } from '$lib/shared/contextAim.svelte.js';

  let {
    node,
    folds,
    depth = 0,
    activeId,
    actions,
    query = '',
    parent = null,
    host = null,
    places = null,
    squeeze = null,
    badge,
    aside,
    unborn = false,
    selected = false,
    lifted = false,
    renaming = false,
    onRename,
    onRenamed,
    onRenameEnd,
    onUnpin,
  }: {
    query?: string;
    host?: ThreadSlot | null;
    places?: Worktrees | null;
    squeeze?: Squeeze | null;
    parent?: ThreadListRow | null;
    node: ThreadTreeNode;
    folds: ThreadFolds;
    depth?: number;
    activeId: string | null;
    actions?: Snippet<[ThreadTreeNode, ContextAim]>;
    badge?: Snippet<[ThreadListRow, number]>;
    aside?: Snippet<[ThreadTreeNode]>;
    unborn?: boolean;
    selected?: boolean;
    lifted?: boolean;
    renaming?: boolean;
    onRename?: (row: ThreadListRow) => void;
    onRenamed?: (row: ThreadListRow, title: string) => Promise<boolean>;
    onRenameEnd?: () => void;
    onUnpin?: (row: ThreadListRow) => void;
  } = $props();

  const wallClock = WallClock.use();
  const shell = shellActs(ShellOps.use(), Notices.use());
  const workspace = Workspace.use();
  const addresses = Addresses.use();

  const BASE_REM = 0.375;
  const INDENT_REM = 0.75;
  const GUTTER_REM = 0.875;

  const TIME_YIELDS =
    'w-6 shrink-0 whitespace-nowrap text-right transition-opacity duration-150 ease-instrument group-hover:opacity-0 group-has-[:focus-visible]:opacity-0 group-has-[[data-state=open]]:opacity-0';

  const SLOT_YIELDS = 'group-hover:opacity-0 group-has-[:focus-visible]:opacity-0';
  const CHEVRON_ON_HOVER = 'opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100';

  const catalog = ProviderCatalog.use();
  const row = $derived(node.row);
  const home = $derived(host === null || row.projectId === host.projectId ? null : row.projectId);
  const homeName = $derived(home === null ? undefined : workspace.find(home)?.name);
  const mark = $derived(host === null ? null : workspace.markOf(row.projectId, host.projectId));
  const isRoot = $derived(row.parentThreadId === null);
  const label = $derived(isRoot ? row.title.trim() || 'Untitled' : (row.name ?? row.agentId));
  const reading = new RowReading(() => node, wallClock, WorkLines.use(), catalog);
  const inTerminal = $derived(row.harness?.process?.origin === 'adopted' && row.harness.process.state !== 'ended');
  const compacting = $derived(row.phase?.phase === 'compacting');
  const hasChildren = $derived(node.children.length > 0);
  const marked = $derived(unborn || reading.mark.state !== 'quiet');
  const filtering = $derived(query.trim() !== '');
  const open = $derived(filtering || folds.isOpen(row.id));
  const collapsed = $derived(hasChildren && !open);
  const detail = $derived(reading.own ?? (collapsed ? reading.team : null));
  const time = $derived(reading.time);
  const timeTone = $derived(reading.timeTone);
  const hot = $derived(row.contextShare !== null && row.contextShare >= CONTEXT_RING_HOT);
  const sameAsParent = $derived(parent !== null && sameSelection(catalog.models, row, parent));
  const step = $derived(squeeze?.step(depth) ?? 0);

  const belowLabel = $derived(
    [
      node.team.working > 0 ? `${node.team.working} working` : null,
      node.team.asking > 0 ? `${node.team.asking} asking` : null,
      node.team.failed > 0 ? `${node.team.failed} failed` : null,
    ]
      .filter((part) => part !== null)
      .join(', '),
  );
  const chevronTone = $derived(
    node.team.asking > 0
      ? 'text-status-open'
      : node.team.working > 0
        ? 'text-status-in-work'
        : node.team.failed > 0
          ? 'text-destructive'
          : 'text-muted-foreground/60 hover:text-foreground',
  );
  const chevronLabel = $derived(`${open ? 'Collapse agents' : 'Expand agents'}${belowLabel === '' ? '' : ` — ${belowLabel}`}`);

  const heldTitle = $derived(`Uncommitted: ${heldWords(row.held.paths, row.held.unproven)}`);
  const pinnedBelow = $derived(!isRoot && row.pinnedAt !== null && onUnpin !== undefined);

  function unpin(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    onUnpin?.(row);
  }

  const scopeRow = untrack(() => node.row);
  const processes = CommandActivity.use().forThread(scopeRow.id, {
    label: scopeRow.name ?? scopeRow.title,
    archived: scopeRow.archivedAt !== null,
    harness: scopeRow.harness !== null,
  });

  let armed = $state(false);
  function arm(): void {
    if (armed) return;
    armed = true;
    flushSync();
  }
  function disarm(link: HTMLAnchorElement): void {
    if (!link.matches(':focus-visible')) armed = false;
  }
  function disarmAfterActivation(event: MouseEvent): void {
    const link = event.currentTarget as HTMLAnchorElement;
    const address = { projectId: row.projectId, threadId: row.id };
    if (
      event.altKey &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      shell.besideOffer(address) !== 'none'
    ) {
      event.preventDefault();
      void shell.openThread(address, 'beside');
    } else if (home !== null && homeName === undefined) {
      event.preventDefault();
      void shell.openThread({ projectId: row.projectId, threadId: row.id }, 'main');
    } else if (event.detail > 0) threadPeeks.press(peekKey);
    setTimeout(() => disarm(link));
  }

  function onRowKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') arm();
    if (event.key === 'Escape' && peeking) {
      event.preventDefault();
      threadPeeks.close(peekKey);
      return;
    }
    if (event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    threadPeeks.toggle(peekKey);
  }

  const contextAim = new ContextAim();

  let link = $state<HTMLAnchorElement | null>(null);
  const peekKey = threadPeeks.key(untrack(() => node.row.id));
  const peeking = $derived(threadPeeks.openId === peekKey);
  $effect(() => () => threadPeeks.leave(peekKey));

  const padLeft = $derived(`${BASE_REM + depth * INDENT_REM}rem`);
  const veinLeft = $derived(depth === 0 ? null : `${BASE_REM + (depth - 1) * INDENT_REM + GUTTER_REM / 2}rem`);
</script>

<div class={['group relative min-w-0 transition-opacity', lifted && 'opacity-40']} inert={unborn}>
  {#if veinLeft !== null}
    <span
      class={[
        'pointer-events-none absolute -top-px bottom-0 w-px bg-vein group-hover:opacity-0 group-has-[:focus-visible]:opacity-0 group-has-[[data-state=open]]:opacity-0',
        (selected || activeId === row.id) && 'opacity-0',
      ]}
      style={`left: ${veinLeft}`}
    ></span>
  {/if}
  <a
    href={armed && (home === null || homeName !== undefined) ? addresses.thread(row.id, homeName) : undefined}
    role={armed ? undefined : 'link'}
    tabindex="0"
    onpointerdown={arm}
    onfocus={arm}
    onblur={() => (armed = false)}
    onpointerenter={(event) => {
      if (event.pointerType !== 'touch') threadPeeks.hover(peekKey);
    }}
    onpointerleave={(event) => {
      disarm(event.currentTarget);
      threadPeeks.leave(peekKey);
    }}
    onclick={disarmAfterActivation}
    onauxclick={disarmAfterActivation}
    oncontextmenu={(event) => {
      if (actions === undefined) return;
      threadPeeks.press(peekKey);
      contextAim.aim(event);
    }}
    onkeydown={onRowKey}
    class={[
      'relative grid cursor-pointer grid-cols-[0.875rem_minmax(0,1fr)_auto] items-start gap-x-1.5 rounded-md py-1 pr-2 text-left text-ui transition-colors',
      // Keyboard focus is drawn INSIDE the row: the app's ring stands 2px outside its element, and
      // in a list with a 1px gap that lands on the neighbours and is cut by the column's edge.
      'focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring',
      selected
        ? 'bg-status-open/10 text-foreground outline-1 -outline-offset-1 outline-status-open/35'
        : activeId === row.id
          ? 'bg-selected text-foreground'
          : 'text-foreground/85 hover:bg-hover focus-visible:bg-selected group-has-[[data-state=open]]:bg-hover',
    ]}
    style={`padding-left: ${padLeft}`}
    data-thread={row.id}
    data-squeeze-depth={squeeze === null ? undefined : depth}
    data-squeeze-step={squeeze === null ? undefined : step}
    inert={renaming}
    bind:this={link}
    {@attach squeeze?.row}
  >
    {#if activeId === row.id && !selected}<span class="pointer-events-none absolute inset-y-1.5 left-0 w-0.5 bg-brand" aria-hidden="true"
      ></span>{/if}
    <span class={['flex h-[18px] items-center', hasChildren && marked && SLOT_YIELDS]}><ThreadLife thread={row} {unborn} /></span>
    <span class="flex h-[18px] min-w-0 items-center gap-1.5 leading-[18px]" data-squeeze-room>
      <FadeText
        data-squeeze-title
        {@attach doubleClick(
          () => onRename?.(row),
          () => isRoot && onRename !== undefined,
        )}><MatchText text={label} {query} prose /></FadeText
      >
      {#if mark !== null}<span class="flex max-w-24 shrink-0" data-squeeze-keep><ProjectMark projectId={mark} class="min-w-0" /></span>{/if}
    </span>
    <span class="relative flex h-[18px] shrink-0 items-center gap-1.5 text-small leading-none" data-squeeze-cluster>
      {#if row.held.paths > 0 || row.held.unproven > 0}
        <span
          class={['flex shrink-0 items-center gap-0.5 tabular text-muted-foreground/70', step >= Stow.files && STOWED]}
          aria-label={heldTitle}
          title={heldTitle}
          data-thread-held
          data-squeeze-piece={Stow.files}
        >
          <ChangesIcon unchecked={row.held.unproven > 0} small />{#if row.held.paths > 0}{row.held.paths}{/if}
        </span>
      {/if}
      <LoadBadge threadId={scopeRow.id} anchor={link} {processes} />
      {#if inTerminal}
        <span
          class="flex shrink-0 items-center gap-0.5 text-muted-foreground/80"
          aria-label="Its CLI runs in a terminal"
          data-thread-in-terminal
        >
          <Terminal class="size-3" aria-hidden="true" />
        </span>
      {/if}
      {#if collapsed}<AgentCounts waiting={node.team.asking} failed={node.team.failed} working={node.team.working} />{/if}
      {#if pinnedBelow}
        <span
          class="grid size-3.5 shrink-0 place-items-center rounded-sm text-muted-foreground/70 outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:bg-selected focus-visible:text-foreground"
          role="button"
          tabindex="0"
          aria-label={`Unpin ${label}`}
          title="Unpin"
          data-thread-pin
          onclick={unpin}
          onkeydown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') unpin(event);
          }}
        >
          <Pin class="size-3" />
        </span>
      {/if}
      {@render badge?.(row, step)}
      <ModelPlate {row} {query} same={sameAsParent} {step} />
      {#if row.contextShare !== null}
        <span class={['flex shrink-0', !hot && step >= Stow.ring && STOWED]} data-squeeze-piece={hot ? undefined : Stow.ring}>
          <ContextRing share={row.contextShare} {compacting} warmth={row.cacheWarmth} provider={row.provider} />
        </span>
      {/if}
      <span class={['tabular', TIME_YIELDS, timeTone]} data-thread-time>{time}</span>
    </span>
    {#if detail !== null}
      <span
        class={['col-span-2 col-start-2 flex h-[15px] min-w-0 items-center gap-2 text-meta leading-[15px]', detail.tone]}
        data-thread-line
      >
        <FadeText text={detail.text} />
        {#if detail.elapsed !== null}<span class="ml-auto shrink-0 tabular" data-thread-line-elapsed>{detail.elapsed}</span>{/if}
      </span>
    {/if}
  </a>
  {#if renaming}
    <RenameField
      value={row.title}
      left={`${BASE_REM + depth * INDENT_REM + 1}rem`}
      label="Thread title"
      class="text-ui"
      onSave={(title) => onRenamed?.(row, title) ?? Promise.resolve(false)}
      onEnd={() => onRenameEnd?.()}
    />
  {/if}
  {@render aside?.(node)}
  {#if peeking && link !== null}
    <ThreadPeek {node} {peekKey} {host} {places} member={mark} anchor={link} {label} {time} {processes} />
  {/if}
  {#if hasChildren && filtering}
    <span
      class={['absolute top-1 flex h-[18px] w-3.5 items-center justify-center text-muted-foreground/60', marked && CHEVRON_ON_HOVER]}
      style={`left: ${padLeft}`}
      aria-hidden="true"
    >
      <ChevronRight class="size-3.5 rotate-90" />
    </span>
  {:else if hasChildren}
    <button
      type="button"
      class={['absolute top-1 flex h-[18px] w-3.5 items-center justify-center rounded-sm', chevronTone, marked && CHEVRON_ON_HOVER]}
      style={`left: ${padLeft}`}
      aria-expanded={open}
      aria-label={chevronLabel}
      onclick={() => folds.toggle(row.id)}
    >
      <ChevronRight class={['size-3.5 transition-transform', open ? 'rotate-90' : '']} />
    </button>
  {/if}
  {@render actions?.(node, contextAim)}
</div>
