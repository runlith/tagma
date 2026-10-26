<script lang="ts">
  import ChevronsDownUp from '@lucide/svelte/icons/chevrons-down-up';
  import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
  import FolderPlus from '@lucide/svelte/icons/folder-plus';
  import Layers from '@lucide/svelte/icons/layers';
  import Plus from '@lucide/svelte/icons/plus';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Search from '@lucide/svelte/icons/search';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import Users from '@lucide/svelte/icons/users';
  import X from '@lucide/svelte/icons/x';
  import { Router } from '@runlith/layer/Router';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { harnessTransport } from '@tagma/server/external-harnesses/settings';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import Told from '$lib/shared/Told.svelte';
  import { Button, buttonVariants } from '$lib/shared/ui/button/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { ExecutionsRepo } from '$lib/features/executions/Repo.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import AgentIcon from '$lib/shared/AgentIcon.svelte';
  import { installInTerminal } from './external/install.js';
  import HarnessMark from './native/HarnessMark.svelte';
  import { launchTitle, type LaunchRow } from './launch.js';
  import type { ThreadSlot } from './ThreadSlot.svelte.js';
  import { AgentTypes } from './AgentTypes.svelte.js';
  import { ModelDefaults } from './ModelDefaults.svelte.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';

  export type AgentsView = 'worktrees' | 'teams';

  let {
    host,
    filter = $bindable(),
    input = $bindable(),
    view,
    several,
    filtering,
    anyOpen,
    foldable,
    onFilterKeys,
    onView,
    onCollapse,
    onExpand,
    onNewFolder,
  }: {
    host: ThreadSlot;
    filter: string;
    input: HTMLInputElement | null;
    view: AgentsView;
    several: boolean;
    filtering: boolean;
    anyOpen: boolean;
    foldable: boolean;
    onFilterKeys: (event: KeyboardEvent) => void;
    onView: (view: AgentsView) => void;
    onCollapse: () => void;
    onExpand: () => void;
    onNewFolder: () => void;
  } = $props();

  const agents = AgentTypes.use();
  const modelDefaults = ModelDefaults.use();
  const catalog = ProviderCatalog.use();
  const settings = SettingsRepo.use();
  const executions = ExecutionsRepo.use();
  const workspace = Workspace.use();
  const notices = Notices.use();
  const router = Router.use();
  const addresses = Addresses.use();

  const agentModel = $derived.by(() => {
    const chosen = modelDefaults.value;
    if (chosen === null) return modelDefaults.unconnected ? 'No model connected' : null;
    return catalog.models.modelsFor(chosen.provider, 'text').find((option) => option.id === chosen.model)?.label ?? chosen.model;
  });

  const roads = $derived(
    (settings.catalog.key(host.projectId).data?.entries.find((row) => row.id === harnessTransport.id)?.value ?? {}) as Readonly<
      Record<string, 'terminal' | 'acp' | undefined>
    >,
  );

  const opensChat = (row: LaunchRow): boolean => !row.presentation.hosted && roads[row.name] === 'acp' && row.presentation.acp;

  async function install(row: LaunchRow, command: string): Promise<void> {
    const project = workspace.find(host.projectId);
    if (project === null) return;
    try {
      const terminal = await installInTerminal(executions, addresses, project, { label: row.label, command });
      if (terminal === null) return;
      void router.goto(terminal.href);
      await terminal.ended;
      await agents.read(true, true);
    } catch (error: unknown) {
      notices.refusal(error);
    }
  }

  function pick(row: LaunchRow): void {
    const command = row.presentation.install;
    if (row.unavailable === null) void host.birth.launch(row.type);
    else if (command !== null) void install(row, command);
  }
</script>

<div class="mx-1.5 flex h-7 shrink-0 items-center gap-1">
  <label
    class="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-sunken px-1.5 text-muted-foreground focus-within:text-foreground"
  >
    <Search class="size-3.5 shrink-0" />
    <input
      bind:this={input}
      bind:value={filter}
      type="text"
      placeholder="Search"
      aria-label="Search agents"
      aria-keyshortcuts="/"
      class="min-w-0 flex-1 bg-transparent text-small text-foreground outline-none placeholder:text-muted-foreground"
      onkeydown={onFilterKeys}
    />
  </label>
  <div class="flex shrink-0 items-center gap-0.5">
    {#if several}
      <div class="flex h-6 items-center rounded-md bg-sunken p-0.5" role="radiogroup" aria-label="Group agents">
        {#each [{ id: 'worktrees', label: 'By worktree', icon: Layers }, { id: 'teams', label: 'By team', icon: Users }] as const as choice (choice.id)}
          <Tooltip text={choice.label}>
            <button
              type="button"
              role="radio"
              aria-checked={view === choice.id}
              aria-label={choice.label}
              class={[
                'grid h-5 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground',
                view === choice.id && 'bg-selected text-foreground',
              ]}
              data-agents-view={choice.id}
              onclick={() => onView(choice.id)}
            >
              <choice.icon class="size-3.5" />
            </button>
          </Tooltip>
        {/each}
      </div>
    {/if}
    <Tooltip text={filtering ? 'Matching paths stay open while filtering' : anyOpen ? 'Collapse all' : 'Expand back'}>
      <button
        type="button"
        class={[
          'grid h-7 shrink-0 place-items-center overflow-hidden rounded-md text-muted-foreground transition-[width,opacity,margin,color,background-color] duration-150 ease-instrument hover:bg-hover hover:text-foreground',
          filtering ? 'w-7 opacity-30' : foldable ? 'w-7 opacity-100' : 'pointer-events-none -ml-0.5 w-0 opacity-0',
        ]}
        aria-label={anyOpen ? 'Collapse all' : 'Expand back'}
        disabled={filtering || !foldable}
        onclick={() => (anyOpen ? onCollapse() : onExpand())}
      >
        {#if anyOpen}
          <ChevronsDownUp class="size-3.5" />
        {:else}
          <ChevronsUpDown class="size-3.5" />
        {/if}
      </button>
    </Tooltip>
    <DropdownMenu.Root
      onOpenChange={(open) => {
        if (open) void agents.read();
      }}
    >
      <Tooltip text="New thread">
        <DropdownMenu.Trigger class={buttonVariants({ variant: 'ghost', size: 'icon-sm' })} aria-label="New thread">
          <Plus class="size-3.5" />
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Content align="end" class="min-w-72">
        <DropdownMenu.Item current={agentModel} onSelect={() => host.startDraft()}>
          {#snippet lead()}<AgentIcon brand class="size-3.5" />{/snippet}
          New agent
        </DropdownMenu.Item>
        {#if agents.launches.length > 0}
          <DropdownMenu.Separator />
          <DropdownMenu.Group>
            <DropdownMenu.GroupHeading>CLI agents</DropdownMenu.GroupHeading>
            {#each agents.launches as row (row.type)}
              {@const installs = row.presentation.install !== null}
              <DropdownMenu.Item
                current={row.unavailable !== null ? (installs ? 'Install' : 'Not installed') : opensChat(row) ? 'Chat' : null}
                disabled={row.unavailable !== null && !installs}
                title={launchTitle(row)}
                onSelect={() => pick(row)}
              >
                {#snippet lead()}<HarnessMark harness={row.name} class="size-3.5" />{/snippet}
                <span class={[row.unavailable !== null && 'text-muted-foreground']}>{row.label}</span>
              </DropdownMenu.Item>
            {/each}
            {#if agents.launches.some((row) => row.unavailable !== null)}
              <DropdownMenu.Item
                icon={agents.searching ? Waiting : RefreshCw}
                closeOnSelect={false}
                disabled={agents.searching}
                onSelect={() => void agents.read(true, true)}
              >
                {agents.searching ? 'Searching…' : 'Check again'}
              </DropdownMenu.Item>
            {/if}
          </DropdownMenu.Group>
        {/if}
        <DropdownMenu.Separator />
        <DropdownMenu.Item icon={FolderPlus} onSelect={onNewFolder}>New folder</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
</div>
{#if host.birth.refusal !== null}
  <div class="flex shrink-0 items-start gap-2 border-b px-3 py-2" role="alert">
    <div class="grid min-w-0 flex-1 gap-1 text-destructive">
      <p class="text-small font-medium">Couldn’t create the thread</p>
      <Told told={host.birth.refusal} />
    </div>
    <Button
      variant="ghost"
      size="icon-sm"
      class="shrink-0 text-muted-foreground"
      aria-label="Dismiss creation error"
      onclick={() => host.birth.dismiss()}
    >
      <X class="size-3.5" />
    </Button>
  </div>
{/if}
