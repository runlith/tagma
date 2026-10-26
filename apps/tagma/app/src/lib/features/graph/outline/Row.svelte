<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { Host } from '@runlith/layer/Host';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { spellModifier } from '$lib/shared/chordSpelling.js';
  import BlockActionsMenu from '$lib/features/graph/outline/BlockActionsMenu.svelte';
  import BlockRow from '$lib/features/graph/outline/BlockRow.svelte';
  import OutlineRow from '$lib/features/graph/outline/Row.svelte';
  import { MARK_EDGE, MARK_LABEL, MARK_SIGN, MARK_TEXT } from '$lib/features/graph/diff.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import type { TitleEdit, TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';
  import { cn } from '$lib/shared/utils.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  const tags = TagCatalog.use();
  const addresses = Addresses.use();
  const apple = Host.use().apple;

  let { store, name }: { store: TreeScreen; name: string } = $props();

  const block = $derived(store.block(name));
  const hasChildren = $derived(store.hasChildren(name));
  const expanded = $derived(store.expanded.has(name));
  const resting = $derived(block !== undefined && tags.isResting(block));
  const off = $derived(block !== undefined && tags.switchedOff(block));
  const passthrough = $derived(store.readingLens.active && !store.matchesFilter(name));
  const mark = $derived(store.marks.get(name));
  const ghost = $derived(store.ghosts.has(name));

  const edit = $derived(store.editing?.name === name && !ghost ? store.editing : null);

  let titleEl = $state<HTMLDivElement | null>(null);
  let link = $state<HTMLAnchorElement | null>(null);
  let held: TitleEdit | null = null;
  let focused = $state(false);

  $effect(() => {
    const el = titleEl;
    const title = block?.title ?? '';
    if (el && !focused && el.textContent !== title) el.textContent = title;
  });

  $effect(() => {
    const el = titleEl;
    const current = edit;
    if (el === null || current === null || current === held) return;
    held = current;
    focusAt(el, current.at);
  });

  function leave(): void {
    focused = false;
    commit();
    if (held === null || !document.hasFocus()) return;
    store.leave(held);
    held = null;
  }

  function onRowKeydown(event: KeyboardEvent): void {
    if (event.key !== 'F2' || ghost) return;
    event.preventDefault();
    store.edit(name);
  }

  function focusAt(el: HTMLElement, at: 'start' | 'end'): void {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(at === 'start');
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function commit(): void {
    if (titleEl) void store.rename(name, titleEl.textContent ?? '');
  }

  function caretOnEdgeLine(el: HTMLElement, edge: 'first' | 'last'): boolean {
    if (!el.textContent) return true;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return true;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.height === 0 && rect.top === 0) return true;
    const box = el.getBoundingClientRect();
    const line = Number.parseFloat(getComputedStyle(el).lineHeight);
    return edge === 'first' ? rect.top - box.top < line / 2 : box.bottom - rect.bottom < line / 2;
  }

  function step(direction: -1 | 1): void {
    const rows = store.visibleNames;
    const index = rows.indexOf(name);
    const target = rows[index + direction];
    if (target !== undefined) store.edit(target, direction === -1 ? 'end' : 'start');
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!titleEl) return;
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.repeat) return;
      commit();
      void store.createAfter(name);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      if (event.repeat) return;
      commit();
      if (event.shiftKey) void store.outdent(name);
      else void store.indent(name);
    } else if (event.key === 'Escape') {
      if (link) link.focus();
      else titleEl.blur();
    } else if (event.key === 'Backspace' && (titleEl.textContent ?? '') === '' && store.children(name).length === 0) {
      event.preventDefault();
      if (!event.repeat) void store.remove(name);
    } else if (event.key === 'ArrowUp' && event.altKey) {
      event.preventDefault();
      if (!event.repeat) void store.moveUp(name);
    } else if (event.key === 'ArrowDown' && event.altKey) {
      event.preventDefault();
      if (!event.repeat) void store.moveDown(name);
    } else if (event.key === 'ArrowLeft' && event.ctrlKey) {
      event.preventDefault();
      if (event.altKey) store.setBranch(name, false);
      else store.collapse(name);
    } else if (event.key === 'ArrowRight' && event.ctrlKey) {
      event.preventDefault();
      if (!hasChildren) return;
      if (event.altKey) store.setBranch(name, true);
      else store.expand(name);
    } else if (event.key === 'ArrowUp' && !event.metaKey && caretOnEdgeLine(titleEl, 'first')) {
      event.preventDefault();
      step(-1);
    } else if (event.key === 'ArrowDown' && !event.metaKey && caretOnEdgeLine(titleEl, 'last')) {
      event.preventDefault();
      step(1);
    }
  }

  function onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text.replace(/\s*\n+\s*/g, ' '));
  }
</script>

{#if block}
  <div>
    <BlockRow
      {block}
      {store}
      href={addresses.block(name)}
      subtree={!hasChildren ? 'none' : expanded || store.readingLens.active ? 'open' : 'collapsed'}
      bind:link
      attributes={{ onkeydown: onRowKeydown }}
      class={cn(passthrough && 'opacity-45', mark && `border-l-2 ${MARK_EDGE[mark]} pl-1.5`)}
    >
      {#snippet leading()}
        {#if mark && MARK_SIGN[mark]}
          <Tooltip text={MARK_LABEL[mark]}>
            <span class={cn('stamp relative mt-1 mr-1 w-3 shrink-0 text-center', MARK_TEXT[mark])}>
              {MARK_SIGN[mark]}
            </span>
          </Tooltip>
        {/if}
        {#if hasChildren && !store.readingLens.active}
          <Tooltip
            text={expanded ? 'Collapse' : 'Expand'}
            hints={[{ keys: spellModifier('alt', apple), words: 'click for the whole branch' }]}
            class="absolute top-[5px] -left-5"
          >
            <button
              type="button"
              class="grid h-full w-full place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
              onclick={(event) => (event.altKey ? store.setBranch(name, !expanded) : store.toggle(name))}
              aria-label={expanded ? 'Collapse' : 'Expand'}
              aria-expanded={expanded}
            >
              <ChevronRight class={cn('size-3.5 transition-transform duration-150 ease-instrument', expanded && 'rotate-90')} />
            </button>
          </Tooltip>
        {/if}
      {/snippet}

      {#snippet title()}
        <div
          bind:this={titleEl}
          class={cn(
            'title min-w-0 flex-1 py-px text-body leading-6 font-normal break-words whitespace-pre-wrap outline-none',
            edit !== null ? 'relative cursor-text' : 'select-none',
            (resting || off) && 'text-muted-foreground',
            tags.restingState(block) === 'closed' && 'line-through decoration-muted-foreground/40',
            ghost && 'text-severity-lie line-through decoration-severity-lie/40',
          )}
          contenteditable={edit !== null ? 'true' : undefined}
          spellcheck="false"
          role={edit !== null ? 'textbox' : undefined}
          aria-label={edit !== null ? 'Title' : undefined}
          data-placeholder="Untitled"
          onfocus={() => (focused = true)}
          onblur={leave}
          onkeydown={onKeydown}
          onpaste={onPaste}
        ></div>
      {/snippet}

      {#snippet trailing()}
        <BlockActionsMenu
          {block}
          {store}
          rename={ghost ? undefined : () => store.edit(name)}
          triggerClass="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100"
        />
      {/snippet}
    </BlockRow>

    {#if (expanded || store.readingLens.active) && hasChildren}
      <div class="branch ml-2 border-l border-vein pl-6 transition-colors duration-150 ease-instrument">
        {#each store.visibleChildren(name) as childName (childName)}
          <OutlineRow {store} name={childName} />
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .title:empty::before {
    content: attr(data-placeholder);
    color: var(--muted-foreground);
    opacity: 0.5;
    pointer-events: none;
  }

  :global(.block-row):hover + .branch,
  :global(.block-row):focus-within + .branch {
    border-color: var(--vein-strong);
  }
</style>
