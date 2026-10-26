<script lang="ts">
  import type { CheckoutEntryStatus, CheckoutLines } from '@tagma/server/workspace/contract/wire/checkout';
  import type { Snippet } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import FileIcon from '$lib/shared/FileIcon.svelte';
  import PathText from '$lib/shared/PathText.svelte';
  import { cn } from '$lib/shared/utils.js';
  import { insetOf } from './changeItem.js';
  import { ENTRY_INK, ENTRY_LETTER } from './entryLetter.js';
  import LineCount from './LineCount.svelte';

  let {
    path,
    status,
    lines,
    selected = false,
    bare = false,
    depth = 0,
    onOpen,
    onKeep,
    link,
    acts,
    aside,
  }: {
    path: string;
    status: CheckoutEntryStatus | null;
    lines: CheckoutLines;
    selected?: boolean;
    bare?: boolean;
    depth?: number;
    onOpen?: (() => void) | undefined;
    onKeep?: (() => void) | undefined;
    link?: Attachment<HTMLElement> | undefined;
    acts?: Snippet;
    aside?: Snippet;
  } = $props();

  const FACE = 'flex h-6 min-w-0 flex-1 items-center gap-1.5 text-left';
  const opens = $derived(onOpen !== undefined || link !== undefined);
</script>

{#snippet face()}
  <FileIcon {path} />
  <PathText
    {path}
    directory={bare ? 'none' : 'after'}
    class="flex-1"
    nameClass={status === 'deleted' ? 'text-muted-foreground line-through' : undefined}
    directoryClass="text-small text-muted-foreground/55"
  />
  {@render aside?.()}
{/snippet}

<div
  class={cn(
    'group/row relative flex h-6 min-w-0 items-center gap-1.5 rounded-md pr-2 text-ui transition-colors',
    selected ? 'bg-selected text-foreground' : opens ? 'text-foreground/90 hover:bg-hover' : 'text-foreground/60',
  )}
>
  {#if !opens}
    <div class={FACE} style:padding-left="{insetOf(depth)}px" data-change-path={path} data-change-shut>
      {@render face()}
    </div>
  {:else}
    <button
      type="button"
      class="{FACE} outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:inset-ring-1 focus-visible:after:inset-ring-ring"
      style:padding-left="{insetOf(depth)}px"
      onclick={link === undefined ? onOpen : undefined}
      ondblclick={onKeep}
      aria-current={selected ? 'true' : undefined}
      data-change-path={path}
      {@attach link}
    >
      {@render face()}
    </button>
  {/if}
  {#if acts !== undefined}
    <span class="relative hidden shrink-0 items-center gap-px group-hover/row:flex group-has-[:focus-visible]/row:flex">
      {@render acts()}
    </span>
  {/if}
  <LineCount {lines} class={cn('shrink-0', acts !== undefined && 'group-hover/row:hidden group-has-[:focus-visible]/row:hidden')} />
  <span class={cn('w-3 shrink-0 text-center font-mono text-meta font-bold', status === null ? '' : ENTRY_INK[status])}>
    {status === null ? '' : ENTRY_LETTER[status]}
  </span>
</div>
