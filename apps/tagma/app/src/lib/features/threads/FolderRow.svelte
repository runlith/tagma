<script lang="ts">
  import Archive from '@lucide/svelte/icons/archive';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Folder from '@lucide/svelte/icons/folder';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import FolderPlus from '@lucide/svelte/icons/folder-plus';
  import FolderX from '@lucide/svelte/icons/folder-x';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import Plus from '@lucide/svelte/icons/plus';
  import { doubleClick } from '$lib/shared/doubleClick.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import RenameField from './RenameField.svelte';
  import AgentCounts from '$lib/shared/ui/AgentCounts.svelte';
  import type { FolderEntry } from './tree.js';

  let {
    entry,
    aimed = false,
    adding = 0,
    renaming = false,
    onToggle,
    onStartRename,
    onRename,
    onCancelRename,
    onNew,
    onNewFolder,
    onArchive,
    onRemove,
  }: {
    entry: FolderEntry;
    aimed?: boolean;
    adding?: number;
    renaming?: boolean;
    onToggle: () => void;
    onStartRename: () => void;
    onRename: (name: string) => Promise<boolean>;
    onCancelRename: () => void;
    onNew: () => void;
    onNewFolder: () => void;
    onArchive: () => void;
    onRemove: () => void;
  } = $props();

  const team = $derived(entry.team);
  const count = $derived(entry.trees.length);
  const padLeft = $derived(`calc(var(--spacing) * ${1.5 + entry.depth * 3})`);
  const tone = $derived(
    entry.open
      ? 'text-muted-foreground'
      : team.asking > 0
        ? 'text-status-open'
        : team.working > 0
          ? 'text-status-in-work'
          : team.failed > 0
            ? 'text-destructive'
            : 'text-muted-foreground',
  );
  const label = $derived(
    [`${entry.open ? 'Collapse' : 'Expand'} the folder ${entry.folder.name}`, `${count} ${count === 1 ? 'agent' : 'agents'}`].join(' — '),
  );

  const YIELDS =
    'transition-opacity duration-150 ease-instrument group-hover/folder:opacity-0 group-has-[:focus-visible]/folder:opacity-0 group-has-[[data-state=open]]/folder:opacity-0';
  const ACT = 'grid h-[18px] w-5 place-items-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground';
</script>

<div class="group/folder relative min-w-0 rounded-md" data-folder-head={entry.folder.id}>
  <button
    type="button"
    class={[
      'grid w-full grid-cols-[0.875rem_minmax(0,1fr)_auto] items-center gap-x-1.5 rounded-md py-1 pr-2 text-left text-ui leading-[18px] transition-colors focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring',
      aimed ? 'bg-status-open/12 outline-1 -outline-offset-1 outline-status-open/50' : 'hover:bg-hover focus-visible:bg-selected',
    ]}
    aria-expanded={entry.open}
    aria-label={label}
    style:padding-left={padLeft}
    data-fold="folder"
    data-folder={entry.folder.id}
    onclick={onToggle}
  >
    {#if entry.open}
      <FolderOpen class={['size-3.5', aimed ? 'text-status-open' : tone]} />
    {:else}
      <Folder class={['size-3.5', aimed ? 'text-status-open' : tone]} />
    {/if}
    <FadeText
      class="justify-self-start font-medium text-foreground/90"
      text={entry.folder.name}
      {@attach doubleClick(() => {
        onToggle();
        onStartRename();
      })}
    />
    <span class={['flex shrink-0 items-center gap-2', YIELDS]}>
      {#if !entry.open}<AgentCounts waiting={team.asking} failed={team.failed} working={team.working} />{/if}
      <span class="tabular min-w-3 text-right text-meta text-muted-foreground/70">
        {count}{#if adding > 0}<span class="font-semibold text-status-open"> +{adding}</span>{/if}
      </span>
    </span>
  </button>
  {#if renaming}
    <RenameField
      value={entry.folder.name}
      left={`calc(var(--spacing) * ${5.5 + entry.depth * 3})`}
      label="Folder name"
      class="text-ui font-medium"
      onSave={onRename}
      onEnd={onCancelRename}
    />
  {:else}
    <div
      class="absolute top-1 right-1.5 flex items-center gap-px opacity-0 transition-opacity duration-150 ease-instrument group-hover/folder:opacity-100 group-has-[:focus-visible]/folder:opacity-100 group-has-[[data-state=open]]/folder:opacity-100"
      data-drag-ignore
    >
      <button type="button" class={ACT} aria-label="New agent in {entry.folder.name}" onclick={onNew}>
        <Plus class="size-3.5" />
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class={ACT} aria-label="Folder actions">
          <Ellipsis class="size-3.5" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="min-w-52" returnFocus={false}>
          <DropdownMenu.Item icon={Plus} onSelect={onNew}>New agent here</DropdownMenu.Item>
          <DropdownMenu.Item icon={FolderPlus} onSelect={onNewFolder}>New folder inside</DropdownMenu.Item>
          <DropdownMenu.Item icon={PencilLine} keys="F2" onSelect={onStartRename}>Rename</DropdownMenu.Item>
          <DropdownMenu.Item icon={Archive} disabled={count === 0} onSelect={onArchive}>
            Archive {count}
            {count === 1 ? 'agent' : 'agents'}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item variant="destructive" icon={FolderX} onSelect={onRemove}>Remove folder…</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  {/if}
</div>
