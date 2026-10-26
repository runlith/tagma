<script lang="ts">
  import type { ThreadFolder } from '@tagma/server/thread-record/contract/wire/folder';
  import Folder from '@lucide/svelte/icons/folder';
  import FolderPlus from '@lucide/svelte/icons/folder-plus';
  import Inbox from '@lucide/svelte/icons/inbox';
  import { match } from '@runlith/search-text/match';
  import FadeText from '$lib/shared/FadeText.svelte';
  import MatchText from '$lib/shared/MatchText.svelte';
  import * as Command from '$lib/shared/ui/command/index.js';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import { folderOutline } from './tree.js';

  export type FolderChoice =
    | { readonly kind: 'folder'; readonly folderId: string }
    | { readonly kind: 'loose' }
    | { readonly kind: 'new'; readonly name: string };

  let {
    folders,
    counts,
    here,
    count,
    anchor,
    onPick,
    onClose,
  }: {
    folders: readonly ThreadFolder[];
    counts: ReadonlyMap<string, number>;
    here: string | null | undefined;
    count: number;
    anchor: HTMLElement;
    onPick: (choice: FolderChoice) => void;
    onClose: () => void;
  } = $props();

  let query = $state('');
  const outline = $derived(folderOutline(folders));
  const typed = $derived(query.replace(/\s+/g, ' ').trim());
  const fresh = $derived(typed !== '' && !folders.some((folder) => folder.name.toLowerCase() === typed.toLowerCase()));
  const shown = $derived(
    outline.flatMap((line) => {
      const hit = match(query, { name: line.folder.name, text: [line.path] });
      return hit === null ? [] : [{ ...line, positions: hit.positions }];
    }),
  );
  const loose = $derived(match(query, { name: 'No folder', text: ['out'] }) !== null);

  function pick(choice: FolderChoice): void {
    onPick(choice);
    onClose();
  }
</script>

<Popover.Root
  open
  onOpenChange={(next) => {
    if (!next) onClose();
  }}
>
  <Popover.Content {anchor} side="bottom" align="start" sideOffset={4} collisionPadding={12} class="w-64 gap-0 p-0" data-folder-picker>
    <Command.Root>
      <Command.Input bind:value={query} placeholder={count > 1 ? `Move ${count} agents to…` : 'Move to folder…'} />
      <Command.List class="max-h-64">
        {#if shown.length === 0 && !loose && !fresh}
          <Command.Empty>No folder matches.</Command.Empty>
        {/if}
        {#each shown as { folder, depth, positions } (folder.id)}
          <Command.Item
            value={folder.id}
            data-checked={here === folder.id}
            style="padding-left: calc(var(--spacing) * {2 + depth * 3})"
            onSelect={() => pick({ kind: 'folder', folderId: folder.id })}
          >
            <Folder class="size-3.5 text-muted-foreground" />
            <FadeText class="flex-1 text-small"><MatchText text={folder.name} {positions} /></FadeText>
            <span class="tabular shrink-0 text-meta text-muted-foreground/70">{counts.get(folder.id) ?? 0}</span>
          </Command.Item>
        {/each}
        {#if loose}
          <Command.Item value="no-folder" data-checked={here === null} onSelect={() => pick({ kind: 'loose' })}>
            <Inbox class="size-3.5 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate text-small">No folder</span>
          </Command.Item>
        {/if}
        {#if fresh}
          <Command.Item value="new-folder" onSelect={() => pick({ kind: 'new', name: typed })}>
            <FolderPlus class="size-3.5 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate text-small">New folder “{typed}”</span>
          </Command.Item>
        {/if}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
