<script lang="ts">
  import Archive from '@lucide/svelte/icons/archive';
  import Check from '@lucide/svelte/icons/check';
  import Folder from '@lucide/svelte/icons/folder';
  import FolderPlus from '@lucide/svelte/icons/folder-plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Pin from '@lucide/svelte/icons/pin';
  import PinOff from '@lucide/svelte/icons/pin-off';
  import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { Filing } from '$lib/features/threads/filing.js';
  import { FolderActs } from '$lib/features/threads/FolderActs.js';
  import { ThreadList } from '$lib/features/threads/List.svelte.js';
  import { folderOutline } from '$lib/features/threads/tree.js';
  import { cn } from '$lib/shared/utils.js';
  import Sheet from './Sheet.svelte';

  let { row, onClose }: { row: ThreadListRow; onClose: () => void } = $props();

  const list = ThreadList.use();
  const filing = new Filing(list, FolderActs.use(), Notices.use());

  type Step = 'acts' | 'rename' | 'folders' | 'shelve';

  let step = $state<Step>('acts');
  let words = $state('');
  const pinned = $derived(row.pinnedAt !== null);
  const label = $derived(row.title.trim() || 'Untitled');
  const folderId = $derived(row.folderId ?? null);

  function begin(next: Step, seed: string): void {
    words = seed;
    step = next;
  }

  async function run(work: (id: string) => Promise<unknown>): Promise<void> {
    const id = row.id;
    onClose();
    await work(id);
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const text = words.trim();
    if (text === '') return;
    if (step === 'rename') void run((id) => list.rename(id, text));
    else void run((id) => filing.shelve([id], text));
  }

  function focusOnOpen(node: HTMLInputElement): void {
    node.focus();
    node.select();
  }
</script>

<Sheet label="Thread actions" title={label} {onClose}>
  {#if step === 'acts'}
    {@render act(Pencil, 'Rename', () => begin('rename', row.title))}
    {@render act(Folder, folderId === null ? 'Move to folder' : 'Move to another folder', () => (step = 'folders'))}
    {@render act(pinned ? PinOff : Pin, pinned ? 'Unpin' : 'Pin', () => {
      const unpin = pinned;
      void run((id) => (unpin ? list.setPinned(id, false) : filing.pin([id])));
    })}
    {@render act(Archive, 'Archive', () => void run((id) => filing.archive([id])), 'text-destructive')}
  {:else if step === 'folders'}
    {#each folderOutline(list.folders) as { folder, path } (folder.id)}
      {@const here = folder.id === folderId}
      {@render act(
        here ? Check : Folder,
        path,
        () => void run((id) => filing.file([id], folder.id)),
        here ? 'text-status-open' : undefined,
      )}
    {/each}
    {#if folderId !== null}
      {@render act(Folder, 'Out of folders', () => void run((id) => filing.file([id], null)))}
    {/if}
    {@render act(FolderPlus, 'New folder…', () => begin('shelve', ''))}
  {:else}
    <form class="grid gap-3 px-5 pt-1 pb-2" onsubmit={submit}>
      <input
        class="h-11 rounded-lg bg-field px-3 text-body text-foreground outline-none ring-1 ring-border focus:ring-ring"
        placeholder={step === 'rename' ? 'Thread title' : 'Folder name'}
        enterkeyhint="done"
        bind:value={words}
        {@attach focusOnOpen}
      />
      <button
        type="submit"
        class="min-h-11 rounded-lg bg-primary text-body font-medium text-primary-foreground disabled:opacity-60"
        disabled={words.trim() === ''}
      >
        {step === 'rename' ? 'Rename' : 'Create and move'}
      </button>
    </form>
  {/if}
</Sheet>

{#snippet act(Icon: typeof Pin, text: string, onclick: () => void, tone?: string)}
  <button type="button" class={cn('flex min-h-12 w-full items-center gap-3 px-5 text-left text-body active:bg-hover', tone)} {onclick}>
    <Icon class="size-4 shrink-0" />
    <span class="min-w-0 flex-1 truncate">{text}</span>
  </button>
{/snippet}
