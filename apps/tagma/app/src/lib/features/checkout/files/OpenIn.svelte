<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Copy from '@lucide/svelte/icons/copy';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { cn } from '$lib/shared/utils.js';
  import EditorIcon from './EditorIcon.svelte';
  import { Outside, type OutsideFile } from './Outside.svelte.js';

  let { file, line }: { file: OutsideFile; line?: (() => number | null) | undefined } = $props();

  const outside = Outside.use();
  const keymap = Keymap.use();

  let open = $state(false);
  let at = $state<number | null>(null);

  const chosen = $derived(outside.chosen);
  const here = (): OutsideFile => ({ ...file, line: line?.() ?? file.line });

  function opened(next: boolean): void {
    if (next) {
      at = here().line;
      outside.look();
    }
    open = next;
  }

  function copy(withLine: boolean): void {
    const place = here();
    void navigator.clipboard.writeText(withLine && place.line !== null ? `${place.path}:${place.line}` : place.path);
  }

  const PART = 'flex h-6 items-center bg-hover text-muted-foreground transition-colors hover:bg-selected hover:text-foreground';
</script>

<span class="mr-1 flex shrink-0 items-stretch" data-open-in>
  {#if chosen !== null}
    <button
      type="button"
      class={cn(PART, 'max-w-40 min-w-0 gap-1.5 rounded-l-md pr-2 pl-1.5 text-small text-foreground')}
      onclick={() => void outside.open(here())}
      data-open-in-chosen={chosen.id}
    >
      <EditorIcon editor={chosen} />
      <FadeText text={`Open in ${chosen.name}`} />
    </button>
  {/if}
  <DropdownMenu.Root bind:open={() => open, opened}>
    <DropdownMenu.Trigger
      class={cn(
        PART,
        'w-5 justify-center data-[state=open]:bg-selected data-[state=open]:text-foreground',
        chosen === null ? 'rounded-md' : 'rounded-r-md border-l',
      )}
      aria-label="Open elsewhere"
    >
      <ChevronDown class="size-3" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="w-64" data-open-in-menu>
      {#if outside.editors.length > 0}
        <DropdownMenu.Label>{at === null ? 'Open in' : `Open at line ${at}`}</DropdownMenu.Label>
        {#each outside.editors as editor (editor.id)}
          <DropdownMenu.Item
            keys={editor.id === chosen?.id ? keymap.spell('file.openIn') : null}
            onSelect={() => void outside.open(here(), editor.id)}
            data-open-in-editor={editor.id}
          >
            {#snippet lead()}<EditorIcon {editor} />{/snippet}
            {editor.name}
          </DropdownMenu.Item>
        {/each}
        <DropdownMenu.Separator />
      {/if}
      {#if outside.local}
        <DropdownMenu.Item icon={FolderOpen} onSelect={() => void outside.reveal(file)}>{outside.finder}</DropdownMenu.Item>
        <DropdownMenu.Separator />
      {/if}
      <DropdownMenu.Item icon={Copy} keys={keymap.spell('file.copy-path')} onSelect={() => copy(false)}>Copy path</DropdownMenu.Item>
      <DropdownMenu.Item icon={Copy} onSelect={() => copy(true)}>Copy path:line</DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</span>
