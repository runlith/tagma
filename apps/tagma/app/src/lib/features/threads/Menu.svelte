<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
  import Archive from '@lucide/svelte/icons/archive';
  import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
  import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
  import ArrowUpLeft from '@lucide/svelte/icons/arrow-up-left';
  import Copy from '@lucide/svelte/icons/copy';
  import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import FolderInput from '@lucide/svelte/icons/folder-input';
  import Forward from '@lucide/svelte/icons/forward';
  import MessageSquareText from '@lucide/svelte/icons/message-square-text';
  import SquareTerminal from '@lucide/svelte/icons/square-terminal';
  import GitFork from '@lucide/svelte/icons/git-fork';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import Pin from '@lucide/svelte/icons/pin';
  import PinOff from '@lucide/svelte/icons/pin-off';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import Shield from '@lucide/svelte/icons/shield';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Square from '@lucide/svelte/icons/square';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Host } from '@runlith/layer/Host';
  import { spellChord } from '$lib/shared/chordSpelling.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import WorktreeSwatch from '$lib/features/worktrees/WorktreeSwatch.svelte';
  import ProjectGlyph from '$lib/features/workspace/ProjectGlyph.svelte';
  import { labelOf } from '$lib/features/workspace/mark.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { stoppableOf } from './rowKind.js';
  import type { ThreadSlot } from './ThreadSlot.svelte.js';
  import type { ThreadList } from './List.svelte.js';
  import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
  import type { ChatNotice } from '@runlith/chat-ui/notice';
  import { stopFailure } from '@runlith/chat-ui/session/TurnCommands.svelte';
  import { ThreadChats } from './ThreadChats.js';
  import type { Draft } from './Draft.svelte.js';
  import { chatNotice } from './notices.js';
  import { detachWithUndo } from './detach.js';
  import TransportChoice from './external/TransportChoice.svelte';
  import type { ContextAim } from '$lib/shared/contextAim.svelte.js';
  import { modeIcon } from './modeWords.js';
  import { ThreadOnScreen } from './OnScreen.svelte.js';

  let {
    row,
    list,
    host,
    aim,
    archived = false,
    onRename,
    onMove,
    acts,
    opens,
    note = null,
    trigger,
    class: className = '',
  }: {
    row: ThreadListRow;
    list: ThreadList;
    host: ThreadSlot;
    aim?: ContextAim;
    archived?: boolean;
    onRename?: () => void;
    onMove?: () => void;
    acts?: Snippet;
    opens?: Snippet;
    note?: string | null;
    trigger?: Snippet;
    class?: string;
  } = $props();

  const notices = Notices.use();
  const apple = Host.use().apple;
  const workspace = Workspace.use();
  const home = $derived(list.homeOf(row.id));
  const project = $derived(workspace.find(home)?.name ?? String(home));
  const names = ThreadNames.use();
  const shell = shellActs(ShellOps.use(), notices);
  const beside = $derived(shell.besideOffer({ projectId: row.projectId, threadId: row.id }));
  const formerParent = $derived.by(() => {
    if (row.parentThreadId !== null || !row.detachedFrom) return null;
    const words = names.of(row.detachedFrom);
    return { label: words?.label ?? row.detachedFrom.slice(0, 8), archived: words?.archived === true };
  });
  let deleting = $state(false);
  let menuOpen = $state(false);
  const anchor = $derived(aim?.anchor ?? null);

  function setOpen(next: boolean): void {
    menuOpen = next;
    if (!next) aim?.clear();
  }

  const naming = $derived(list.busy(row.id, 'title'));
  const restarting = $derived(list.busy(row.id, 'restart'));
  const chats = ThreadChats.use();
  let stopTold = $state.raw<ChatNotice | null>(null);

  async function stop(): Promise<void> {
    const runId = stoppableOf(row);
    if (runId === null) return;
    stopTold = null;
    const failure = stopFailure<Draft>(await chats.stop(row.projectId, row.id, runId));
    stopTold = failure === null ? null : chatNotice(failure);
  }

  const stoppable = $derived(stoppableOf(row));
  const stopping = $derived(stoppable === null ? null : chats.of(row.projectId).stops.phase(row.id, stoppable));

  const places = $derived(host.places);
  const placed = $derived(places.placeOf(row.id));
  const targets = $derived(
    places.several && row.projectId === host.projectId ? places.targets.filter((one) => one.rootId !== placed?.rootId) : [],
  );
  const destinations = $derived(
    !archived && home === host.projectId
      ? [
          ...workspace.projects.filter((one) => one.id !== home && one.kind === 'folder'),
          ...workspace.projects.filter((one) => one.id !== home && one.kind === 'global'),
        ]
      : [],
  );

  const isRoot = $derived(row.parentThreadId === null);
  const forks = $derived(row.capabilities.history !== 'none' && row.capabilities.copies?.whole !== 'none');

  const screen = ThreadOnScreen.use();
  const shownSlot = $derived(screen.shown.find((slot) => slot.activeId === row.id) ?? null);
  const activeMode = $derived.by(() => {
    const modes = shownSlot?.writes.modes ?? null;
    return modes?.declared.find((one) => one.id === modes.active) ?? null;
  });

  async function generateTitle(): Promise<void> {
    try {
      await list.generateTitle(row.id);
    } finally {
      setOpen(false);
    }
  }

  async function fork(): Promise<void> {
    const source = row;
    const threadId = await list.fork(source);
    if (threadId !== null) await shell.openThread({ projectId: source.projectId, threadId }, 'main');
  }

  async function remove(): Promise<void> {
    const removed = await list.remove(row.id);
    if (!removed) return;
    host.forget(row.id);
    deleting = false;
  }
</script>

<DropdownMenu.Root bind:open={() => menuOpen || anchor !== null, setOpen}>
  <DropdownMenu.Trigger class={className} aria-label="Thread actions">
    {#if trigger}{@render trigger()}{:else}<Ellipsis class="size-3.5" />{/if}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content
    anchor={anchor ?? undefined}
    align={anchor === null ? 'end' : 'start'}
    sideOffset={anchor === null ? undefined : 0}
    class="min-w-56"
    returnFocus={false}
  >
    {#if stoppable !== null}
      <DropdownMenu.Item
        icon={stopping === null ? Square : Waiting}
        disabled={stopping !== null}
        closeOnSelect={false}
        onSelect={() => void stop()}
      >
        {stopping === null ? 'Stop' : stopping === 'stopping' ? 'Stopping…' : 'Being stopped'}
      </DropdownMenu.Item>
      {#if stopTold}
        <DropdownMenu.Note role="status" tone={stopTold.tone === 'error' ? 'destructive' : 'muted'} text={stopTold.message} />
      {/if}
    {/if}
    <DropdownMenu.Item icon={restarting ? Waiting : RotateCw} disabled={restarting} onSelect={() => void list.restart(row.id)}>
      {restarting ? 'Restarting agent…' : 'Restart agent'}
    </DropdownMenu.Item>
    {#if shownSlot !== null && shownSlot.surface.terminal !== null && shownSlot.writes.modes !== null && activeMode !== null}
      {@const slot = shownSlot}
      {@const modes = shownSlot.writes.modes}
      {@const refusal = shownSlot.views.authority.terminalRefusal}
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger icon={modeIcon(activeMode) ?? Shield} current={activeMode.label}>Approval</DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent class="min-w-48">
          <DropdownMenu.RadioGroup value={modes.active} onValueChange={(id) => void slot.writes.perform(slot.writes.chooseMode(id))}>
            {#each modes.declared as mode (mode.id)}
              <DropdownMenu.RadioItem value={mode.id} icon={modeIcon(mode) ?? Shield}>{mode.label}</DropdownMenu.RadioItem>
            {/each}
          </DropdownMenu.RadioGroup>
          {#if refusal !== null}
            <DropdownMenu.Separator />
            <DropdownMenu.Note role="alert" tone="destructive" text={refusal} />
          {/if}
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
    {/if}
    <TransportChoice {row} projectId={home} part="act" />
    {#if isRoot}
      <DropdownMenu.Separator />
      {#if onRename}
        <DropdownMenu.Item icon={PencilLine} onSelect={onRename}>Rename</DropdownMenu.Item>
      {/if}
      <DropdownMenu.Item icon={naming ? Waiting : Sparkles} closeOnSelect={false} disabled={naming} onSelect={() => void generateTitle()}>
        {naming ? 'Generating title…' : 'Generate title'}
      </DropdownMenu.Item>
    {/if}
    <DropdownMenu.Separator />
    {#if !archived}
      <DropdownMenu.Item
        icon={row.pinnedAt === null ? Pin : PinOff}
        disabled={list.busy(row.id, 'pin')}
        onSelect={() => void list.setPinned(row.id, row.pinnedAt === null)}
      >
        {row.pinnedAt === null ? 'Pin' : 'Unpin'}
      </DropdownMenu.Item>
      {#if onMove}
        <DropdownMenu.Item icon={FolderInput} keys="M" onSelect={onMove}>Move to folder…</DropdownMenu.Item>
      {/if}
      {#if targets.length > 0}
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger icon={ArrowRightLeft} disabled={places.moving.includes(row.id)}>Move to worktree</DropdownMenu.SubTrigger
          >
          <DropdownMenu.SubContent class="max-h-80 min-w-56 overflow-y-auto">
            {#each targets as target (target.rootId)}
              <DropdownMenu.Item onSelect={() => void places.move(row.id, target.rootId)}>
                {#snippet lead()}<WorktreeSwatch row={target} />{/snippet}
                <span class="font-mono text-small">{target.branch ?? target.name}</span>
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
      {/if}
      {#if destinations.length > 0}
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger icon={Forward} disabled={places.moving.includes(row.id)}>Move to project</DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent class="max-h-80 min-w-56 overflow-y-auto">
            {#each destinations as destination (destination.id)}
              <DropdownMenu.Item onSelect={() => void places.move(row.id, 'main', destination.id)}>
                {#snippet lead()}<ProjectGlyph project={destination} />{/snippet}
                <FadeText class="min-w-0">{labelOf(destination)}</FadeText>
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
      {/if}
      {#if !isRoot}
        <DropdownMenu.Item
          icon={ArrowUpLeft}
          disabled={list.busy(row.id, 'detach')}
          onSelect={() => void detachWithUndo(list, notices, row)}
        >
          Detach from {list.labelOf(row.parentThreadId ?? '') ?? 'parent'}
        </DropdownMenu.Item>
      {:else if formerParent !== null}
        <DropdownMenu.Item
          icon={CornerDownRight}
          disabled={formerParent.archived || list.busy(row.id, 'detach')}
          onSelect={() => void list.detach(row.id, false)}
        >
          Return under {formerParent.label}{formerParent.archived ? ' (archived)' : ''}
        </DropdownMenu.Item>
      {/if}
    {/if}
    {#if archived}
      <DropdownMenu.Item
        icon={ArchiveRestore}
        disabled={list.busy(row.id, 'archive')}
        onSelect={() => void list.setArchived(row.id, false)}
      >
        Unarchive
      </DropdownMenu.Item>
    {:else}
      <DropdownMenu.Item icon={Archive} disabled={list.busy(row.id, 'archive')} onSelect={() => void list.setArchived(row.id, true)}>
        Archive
      </DropdownMenu.Item>
    {/if}
    {#if forks || acts !== undefined}
      <DropdownMenu.Separator />
      {#if forks}
        <DropdownMenu.Item icon={GitFork} disabled={list.busy(row.id, 'fork')} onSelect={() => void fork()}>Fork</DropdownMenu.Item>
      {/if}
      {@render acts?.()}
    {/if}
    {#if beside !== 'none' || opens !== undefined}
      <DropdownMenu.Separator />
      {#if beside !== 'none'}
        <DropdownMenu.Item
          icon={PanelRight}
          keys={spellChord({ key: 'click', meta: false, ctrl: false, alt: true, shift: false }, apple)}
          onSelect={() => void shell.openThread({ projectId: row.projectId, threadId: row.id }, 'beside')}
        >
          {beside === 'show' ? 'Show beside' : 'Open beside'}
        </DropdownMenu.Item>
      {/if}
      {@render opens?.()}
    {/if}
    {#if shownSlot !== null && shownSlot.surface.switchable}
      {@const slot = shownSlot}
      <DropdownMenu.Separator />
      <DropdownMenu.Item icon={slot.surface.kind === 'chat' ? SquareTerminal : MessageSquareText} onSelect={() => slot.surface.toggle()}>
        {slot.surface.kind === 'chat' ? 'Show the terminal' : 'Show as chat'}
      </DropdownMenu.Item>
    {/if}
    <DropdownMenu.Separator />
    <DropdownMenu.Item icon={Copy} onSelect={() => navigator.clipboard.writeText(row.id)}>Copy thread ID</DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Item variant="destructive" icon={Trash2} onSelect={() => (deleting = true)}>Delete</DropdownMenu.Item>
    <TransportChoice {row} projectId={home} part="note" />
    {#if note !== null}
      <DropdownMenu.Separator />
      <DropdownMenu.Note text={note} />
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>

{#if deleting}
  <Dialog.Root
    open
    onOpenChange={(next) => {
      if (!next) deleting = false;
    }}
  >
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title class="text-page">Delete “{row.title.trim() || 'Untitled'}”?</Dialog.Title>
        <Dialog.Description>The transcript goes with it. Blocks the agent changed stay in the graph.</Dialog.Description>
        <p class="break-all text-small text-muted-foreground">Project: {project} · thread {row.id}</p>
      </Dialog.Header>
      <Dialog.Footer>
        <Button variant="outline" data-runlith-autofocus-ignore onclick={() => (deleting = false)}>Cancel</Button>
        <Button variant="confirm" disabled={list.busy(row.id, 'delete')} onclick={() => void remove()}>Delete</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
