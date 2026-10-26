<script lang="ts">
  import Copy from '@lucide/svelte/icons/copy';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import FolderPlus from '@lucide/svelte/icons/folder-plus';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import SquareArrowOutUpRight from '@lucide/svelte/icons/square-arrow-out-up-right';
  import TextSearch from '@lucide/svelte/icons/text-search';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { untrack } from 'svelte';
  import EditorIcon from './EditorIcon.svelte';
  import { Outside } from './Outside.svelte.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import type { MenuAim } from './treeMoves.js';

  let {
    aim,
    onClose,
    onCreate,
    onRename,
    onDelete,
    onCopy,
    onFind,
    onReveal,
    onOpenIn,
  }: {
    aim: MenuAim | null;
    onClose: () => void;
    onCreate: (dir: string, kind: 'file' | 'folder') => void;
    onRename: (path: string) => void;
    onDelete: (paths: readonly string[]) => void;
    onCopy: (path: string, relative: boolean) => void;
    onFind: (dir: string) => void;
    onReveal: (path: string) => void;
    onOpenIn: (path: string, editor: string) => void;
  } = $props();

  const outside = Outside.use();
  const one = $derived(aim !== null && aim.paths.length === 1);

  $effect(() => {
    if (aim !== null) untrack(() => outside.look());
  });

  function run(act: (aim: MenuAim) => void): void {
    const target = aim;
    onClose();
    if (target !== null) act(target);
  }
</script>

<DropdownMenu.Root bind:open={() => aim !== null, (next) => !next && onClose()}>
  <DropdownMenu.Content anchor={aim === null ? undefined : { x: aim.x, y: aim.y }} class="w-52" align="start" sideOffset={0} data-tree-menu>
    {#if aim?.directory === true || one}
      {#if aim?.directory === true}
        <DropdownMenu.Item icon={FilePlus} onSelect={() => run((target) => onCreate(target.path, 'file'))}>New file</DropdownMenu.Item>
        <DropdownMenu.Item icon={FolderPlus} onSelect={() => run((target) => onCreate(target.path, 'folder'))}>New folder</DropdownMenu.Item
        >
      {/if}
      {#if one}
        <DropdownMenu.Item icon={PencilLine} onSelect={() => run((target) => onRename(target.path))}>Rename</DropdownMenu.Item>
      {/if}
      <DropdownMenu.Separator />
    {/if}
    {#if aim?.directory === true || one}
      {#if aim?.directory === true}
        <DropdownMenu.Item icon={TextSearch} onSelect={() => run((target) => onFind(target.path))}>Find in folder</DropdownMenu.Item>
      {/if}
      {#if aim !== null && one}
        <DropdownMenu.Item icon={FolderOpen} onSelect={() => run((target) => onReveal(target.path))}>{outside.finder}</DropdownMenu.Item>
        {#if !aim.directory && outside.editors.length > 0}
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger icon={SquareArrowOutUpRight}>Open in</DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent class="w-52" data-tree-open-in>
              {#each outside.editors as editor (editor.id)}
                <DropdownMenu.Item onSelect={() => run((target) => onOpenIn(target.path, editor.id))}>
                  {#snippet lead()}<EditorIcon {editor} />{/snippet}
                  {editor.name}
                </DropdownMenu.Item>
              {/each}
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>
        {/if}
      {/if}
      <DropdownMenu.Separator />
    {/if}
    <DropdownMenu.Item icon={Copy} onSelect={() => run((target) => onCopy(target.path, false))}>Copy path</DropdownMenu.Item>
    <DropdownMenu.Item icon={Copy} onSelect={() => run((target) => onCopy(target.path, true))}>Copy relative path</DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Item variant="destructive" icon={Trash2} onSelect={() => run((target) => onDelete(target.paths))}>
      {aim !== null && aim.paths.length > 1 ? `Delete ${aim.paths.length} items` : 'Delete'}
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
