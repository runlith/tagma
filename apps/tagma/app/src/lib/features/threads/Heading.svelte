<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import FileText from '@lucide/svelte/icons/file-text';
  import Plus from '@lucide/svelte/icons/plus';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { tick } from 'svelte';
  import { Overlay } from '@runlith/primitives/Overlay.svelte';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import { DEFAULT_THREAD_TYPE } from '@tagma/server/threads/contract/wire/settings';
  import type { ThreadSlot } from './ThreadSlot.svelte.js';
  import { AgentLibraryOverlay } from './overlay.js';
  import { ThreadList } from './List.svelte.js';
  import { AgentTypes } from './AgentTypes.svelte.js';
  import AgentIcon from '$lib/shared/AgentIcon.svelte';
  import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
  import ThreadHold from '$lib/features/workspace/ThreadHold.svelte';
  import ChangesCount from '$lib/features/checkout/ChangesCount.svelte';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import ThreadLife, { threadMark } from './Life.svelte';
  import ThreadMenu from './Menu.svelte';
  import ThisThread from './ThisThread.svelte';
  import WorksOn from './WorksOn.svelte';

  let { host }: { host: ThreadSlot } = $props();

  const list = ThreadList.use();
  const agents = AgentTypes.use();
  const overlay = Overlay.use();
  const shell = shellActs(ShellOps.use(), Notices.use());

  const draft = $derived(host.activeId === null);
  const draftName = $derived(host.draft.name);
  const thread = $derived(host.identity);
  const row = $derived(host.activeId === null ? undefined : list.row(host.activeId));
  const isRoot = $derived(thread === null || thread.parentThreadId === null);
  const parent = $derived(thread?.parent);
  const bornType = $derived(thread?.bornAs ?? null);
  const bornLabel = $derived(bornType === DEFAULT_THREAD_TYPE ? 'Tagma' : bornType);
  const title = $derived(isRoot ? thread?.title.trim() || 'Untitled' : (row?.name ?? bornLabel ?? 'Untitled'));
  const accountMissing = $derived(host.views.model.accountMissing);
  const accountMove = $derived(host.views.model.accountMove);

  const types = $derived(agents.agents);
  const rejected = $derived(agents.rejected);
  const chosenType = $derived(host.birth.nextType);
  const chosen = $derived(types.find((type) => type.id === chosenType));
  const offersChoice = $derived(types.length > 1 || rejected.length > 0);
  const others = $derived(types.filter((type) => type.id !== bornType));

  $effect(() => {
    if (draft || agents.rows === null) void agents.read();
  });

  function inspect(): void {
    overlay.open(AgentLibraryOverlay, {
      projectId: host.projectId,
      ...(host.activeId ? { threadId: host.activeId } : { agentId: chosenType }),
      onSaved: () => {
        void agents.read(true);
        void host.skills.refresh();
      },
    });
  }

  function openAtHome(id: string, projectId: number): void {
    if (projectId === host.projectId) host.open(id);
    else void shell.openThread({ projectId, threadId: id }, 'main');
  }

  let renaming = $state(false);
  let renameTitle = $state('');
  let renameInput = $state<HTMLInputElement | null>(null);

  function startRename(): void {
    if (!thread || !isRoot) return;
    renameTitle = thread.title;
    renaming = true;
    void tick().then(() => renameInput?.focus());
  }

  async function saveRename(): Promise<void> {
    const id = host.activeId;
    if (id === null) {
      renaming = false;
      return;
    }
    if (await list.rename(id, renameTitle)) renaming = false;
  }

  const AGENT =
    'no-drag-region inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-hover px-1.5 text-small font-medium text-foreground transition-colors hover:bg-hover';
  const CRUMB = 'no-drag-region flex min-w-0 max-w-48 shrink text-small text-muted-foreground hover:text-foreground';
  const TITLE =
    'no-drag-region flex h-7 min-w-0 max-w-96 shrink items-center gap-1.5 rounded-md px-2 text-ui font-medium transition-colors hover:bg-hover data-[state=open]:bg-selected';
</script>

{#snippet bornActs()}
  {#if others.length > 0}
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger icon={Plus}>New thread as</DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent class="min-w-48">
        {#each others as type (type.id)}
          <DropdownMenu.Item icon={AgentIcon} title={type.description} onSelect={() => host.startDraftAs(type.id)}>
            {type.name}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
  {/if}
{/snippet}

{#snippet bornOpens()}
  <DropdownMenu.Item icon={FileText} onSelect={inspect}>View this thread’s prompt</DropdownMenu.Item>
{/snippet}

{#snippet titled()}
  {#if row && threadMark(row).state !== 'quiet'}<span class="flex shrink-0 items-center"><ThreadLife thread={row} /></span>{/if}
  <FadeText text={title} />
  <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
{/snippet}

<div class="flex h-full min-w-0 flex-1 items-center gap-1.5" data-thread-heading>
  {#if draft}
    <FadeText class="max-w-64 text-ui font-medium text-muted-foreground" text={draftName} />
    {#if types.length > 0}
      <span class="shrink-0 text-small text-muted-foreground/70">as</span>
      {#if offersChoice}
        <DropdownMenu.Root>
          <Tooltip
            text={rejected.length === 0
              ? 'The agent this thread is born as'
              : `The agent this thread is born as — ${rejected.length} agent file${rejected.length === 1 ? '' : 's'} could not be offered`}
          >
            <DropdownMenu.Trigger class={AGENT}>
              <AgentIcon brand class="size-3.5 shrink-0" />
              <FadeText text={chosen?.name ?? chosenType} />
              {#if rejected.length > 0}<span class="text-destructive" aria-label="agent files rejected">!</span>{/if}
              <ChevronDown class="size-3 text-muted-foreground" />
            </DropdownMenu.Trigger>
          </Tooltip>
          <DropdownMenu.Content align="start" class="min-w-64 max-w-sm">
            <DropdownMenu.RadioGroup
              value={chosenType}
              onValueChange={(value) => host.birth.applyType(value === agents.defaultType ? null : value)}
            >
              {#each types as type (type.id)}
                <DropdownMenu.RadioItem
                  value={type.id}
                  icon={AgentIcon}
                  title={type.baseAgentId === type.id ? type.description : `${type.id}: ${type.description}`}
                >
                  {type.name}
                </DropdownMenu.RadioItem>
              {/each}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator />
            <DropdownMenu.Item icon={FileText} onSelect={inspect}>View definition</DropdownMenu.Item>
            {#if rejected.length > 0}
              <DropdownMenu.Separator />
              {#each rejected as file (file.path)}
                <DropdownMenu.Note tone="destructive" title={file.reason} text={`${file.path.split('/').pop()} rejected: ${file.reason}`} />
              {/each}
            {/if}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {:else}
        <Tooltip text="Read this agent’s prompt and definition">
          <button type="button" class={AGENT} onclick={inspect}>
            <AgentIcon brand class="size-3.5 shrink-0" />
            {chosen?.name ?? chosenType}
          </button>
        </Tooltip>
      {/if}
    {/if}
  {:else if thread}
    {#if parent}
      <Tooltip text={`Spawned under ${parent.title.trim() || 'Untitled'}`} class="flex min-w-0 shrink-[3]">
        <button type="button" class={CRUMB} onclick={() => openAtHome(parent.id, parent.projectId)}>
          <FadeText text={parent.title.trim() || 'Untitled'} />
        </button>
      </Tooltip>
      <span class="shrink-0 text-muted-foreground/45" aria-hidden="true">/</span>
    {/if}
    {#if renaming}
      <form
        class="no-drag-region min-w-0 max-w-96 flex-1"
        onsubmit={(event) => {
          event.preventDefault();
          void saveRename();
        }}
      >
        <Input
          bind:ref={renameInput}
          bind:value={renameTitle}
          maxlength={120}
          class="h-7 border-0 bg-transparent px-1 text-ui font-medium shadow-none focus-visible:ring-1"
          onkeydown={(event) => {
            if (event.key === 'Escape') renaming = false;
          }}
          onblur={() => void saveRename()}
        />
      </form>
    {:else if row}
      <ThreadMenu
        {row}
        {list}
        {host}
        places={row.projectId === host.projectId ? host.places : null}
        archived={row.archivedAt !== null}
        onRename={isRoot ? startRename : undefined}
        acts={others.length > 0 ? bornActs : undefined}
        opens={bornOpens}
        note={host.views.model.accountLabel ? `Account: ${host.views.model.accountLabel}` : null}
        trigger={titled}
        class={TITLE}
      />
    {:else}
      <span class="flex min-w-0 max-w-96 px-2 text-ui font-medium"><FadeText text={title} /></span>
    {/if}
    {#if host.activeId}
      <WorksOn projectId={host.projectId} threadId={host.activeId} />
    {/if}
    {#if bornLabel !== null && bornType !== agents.defaultType}
      <Tooltip text="The agent this thread was born as — read its prompt">
        <button type="button" class={AGENT} onclick={inspect}>
          <FadeText text={bornLabel} />
        </button>
      </Tooltip>
    {/if}
    {#if accountMove !== null && host.activeId}
      {@const id = host.activeId}
      {@const move = accountMove}
      {@const restarting = list.busy(id, 'restart')}
      <span class="no-drag-region flex min-w-0 shrink items-center gap-1.5" data-account-move>
        <span class="flex min-w-0 shrink items-center gap-1 text-small {move.limited ? 'text-severity-lie' : 'text-muted-foreground'}">
          {#if move.limited}<TriangleAlert class="size-3.5 shrink-0" />{/if}
          <FadeText text={move.limited ? `${move.standing} hit its limit` : `On ${move.standing}`} />
        </span>
        <Tooltip
          text={`The CLI runs on ${move.standing}; ${move.chosen} is chosen. Starts the CLI on ${move.chosen} with this conversation${move.limited ? ' and continues the turn the limit stopped' : ''}. Commands the CLI is running end with it.`}
          class="flex min-w-0 shrink"
        >
          <Button
            type="button"
            size="xs"
            variant={move.limited ? 'default' : 'outline'}
            class="min-w-0 shrink"
            disabled={restarting}
            onclick={() => void list.restart(id)}
          >
            {#if restarting}<Waiting class="size-3" />{/if}
            <FadeText text={`Continue on ${move.chosen}`} />
          </Button>
        </Tooltip>
      </span>
    {/if}
    {#if accountMissing && host.views.model.chosenLabel}
      <Tooltip text={`${host.views.model.chosenLabel} is no longer stored: the next turn fails with this key.`}>
        <span
          class="grid shrink-0 place-items-center text-severity-lie"
          role="img"
          aria-label={`${host.views.model.chosenLabel} is no longer stored`}
        >
          <TriangleAlert class="size-3.5" />
        </span>
      </Tooltip>
    {/if}
  {/if}
  <div class="no-drag-region ml-auto flex shrink-0 items-center gap-0.5">
    {#if thread}
      {#key thread.id}
        <ThreadHold thread={thread.id}>
          <ChangesCount />
          <ThisThread thread={thread.id} here={host.projectId} />
        </ThreadHold>
      {/key}
    {/if}
  </div>
</div>
