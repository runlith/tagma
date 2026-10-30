<script lang="ts" generics="T">
  import { type Snippet, untrack } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import ArrowRightToLine from '@lucide/svelte/icons/arrow-right-to-line';
  import CopyX from '@lucide/svelte/icons/copy-x';
  import ListX from '@lucide/svelte/icons/list-x';
  import X from '@lucide/svelte/icons/x';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import RailMark from '$lib/shared/ui/RailMark.svelte';
  import { tabLook } from '$lib/shared/ui/tab.js';
  import { type Beyond, glide, Reorder } from './Reorder.svelte.js';
  import { cn } from './utils.js';

  type Props = {
    items: readonly T[];
    key: (item: T) => string;
    active: string | null;
    label: string;
    name: (item: T) => string;
    activate: (id: string) => void;
    close: (id: string) => void;
    move: (id: string, before: string | null) => void;
    tab: Snippet<[T, boolean]>;
    title?: (item: T) => string | undefined;
    keep?: (id: string) => void;
    closeOthers?: (id: string) => void;
    closeRight?: (id: string) => void;
    closeAll?: () => void;
    acts?: Snippet<[T]>;
    copies?: Snippet<[T]>;
    context?: (item: T, event: MouseEvent) => void;
    closeLabel?: (item: T) => string;
    here?: boolean;
    after?: Snippet;
    end?: Snippet;
    beyond?: Beyond<string>;
    class?: string;
  };

  let {
    items,
    key,
    active,
    label,
    name,
    activate,
    close,
    move,
    tab,
    title,
    keep,
    closeOthers,
    closeRight,
    closeAll,
    acts,
    copies,
    context,
    closeLabel,
    here = false,
    after,
    end,
    beyond,
    class: className,
  }: Props = $props();

  const LINE_PX = 16;

  const reorder = new Reorder(
    () => items.map(key),
    (id, before) => move(id, before),
    'x',
    untrack(() => beyond),
  );

  let aimed = $state<{ readonly id: string; readonly x: number; readonly y: number } | null>(null);
  const target = $derived(aimed === null ? null : (items.find((item) => key(item) === aimed?.id) ?? null));
  let edges = $state({ start: false, end: false });
  let measure: (() => void) | null = null;

  const ids = (): readonly string[] => items.map(key);

  function others(id: string): void {
    if (closeOthers !== undefined) closeOthers(id);
    else for (const other of ids()) if (other !== id) close(other);
  }

  function right(id: string): void {
    if (closeRight !== undefined) closeRight(id);
    else for (const other of ids().slice(ids().indexOf(id) + 1)) close(other);
  }

  function all(): void {
    if (closeAll !== undefined) closeAll();
    else for (const id of ids()) close(id);
  }

  function run(act: (id: string) => void): void {
    const item = target;
    aimed = null;
    if (item !== null) act(key(item));
  }

  const shown =
    (on: boolean): Attachment<HTMLElement> =>
    (node) => {
      const strip = node.parentElement;
      if (!on || strip === null) return;
      const margin = getComputedStyle(node);
      const tab = node.getBoundingClientRect();
      const bounds = strip.getBoundingClientRect();
      const before = tab.left - parseFloat(margin.scrollMarginLeft) - bounds.left;
      const after = tab.right + parseFloat(margin.scrollMarginRight) - bounds.right;
      if (before < 0) strip.scrollLeft += before;
      else if (after > 0) strip.scrollLeft += after;
    };

  const rail: Attachment<HTMLElement> = (node) => {
    const read = (): void => {
      const first = node.firstElementChild;
      const last = node.lastElementChild;
      const extent =
        first instanceof HTMLElement && last instanceof HTMLElement ? last.offsetLeft + last.offsetWidth - first.offsetLeft : 0;
      const start = node.scrollLeft > 1;
      const end = node.scrollLeft + node.clientWidth < extent - 1;
      if (start !== edges.start || end !== edges.end) edges = { start, end };
    };
    const wheel = (event: WheelEvent): void => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || node.scrollWidth <= node.clientWidth) return;
      event.preventDefault();
      node.scrollLeft += event.deltaY * (event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? node.clientWidth : 1);
    };
    const observer = new ResizeObserver(read);
    observer.observe(node);
    node.addEventListener('scroll', read, { passive: true });
    node.addEventListener('wheel', wheel, { passive: false });
    measure = read;
    read();
    return () => {
      measure = null;
      observer.disconnect();
      node.removeEventListener('scroll', read);
      node.removeEventListener('wheel', wheel);
    };
  };

  $effect(() => {
    void items.length;
    measure?.();
  });
</script>

<div class={cn('flex min-w-0 items-stretch', className)} data-tab-strip>
  <div
    class="no-drag-region rail-scroll flex min-w-0 flex-initial items-stretch gap-1 overflow-x-auto overflow-y-hidden py-1 no-scrollbar"
    role="tablist"
    aria-label={label}
    data-fade-start={edges.start || undefined}
    data-fade-end={edges.end || undefined}
    {@attach reorder.attach}
    {@attach rail}
  >
    {#each reorder.arranged(items, key) as item (key(item))}
      {@const id = key(item)}
      {@const on = id === active}
      {@const carried = reorder.carried === id}
      <div
        role="tab"
        tabindex="0"
        aria-selected={on}
        title={reorder.carried !== null ? undefined : title?.(item)}
        data-tab-id={id}
        data-reorder-item={id}
        data-reorder-handle={id}
        data-carried={carried || undefined}
        style:translate={reorder.offset(id)}
        animate:glide
        {@attach shown(on)}
        class={cn(
          tabLook(on),
          'group/tab relative w-48 min-w-28 shrink scroll-mx-6 px-2',
          carried ? 'z-10 cursor-grabbing bg-raised text-foreground shadow-float' : 'transition',
        )}
        onclick={() => activate(id)}
        ondblclick={() => keep?.(id)}
        onauxclick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            close(id);
          }
        }}
        oncontextmenu={(event) => {
          event.preventDefault();
          if (context !== undefined) context(item, event);
          else aimed = { id, x: event.clientX, y: event.clientY };
        }}
        onkeydown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate(id);
          }
        }}
      >
        <span
          class={cn(
            'flex min-w-0 flex-1 items-center gap-1.5',
            on ? 'fade-under' : 'group-hover/tab:fade-under group-focus-visible/tab:fade-under',
          )}
        >
          {@render tab(item, on)}
        </span>
        {#if here}<RailMark current={on} edge="bottom" />{/if}
        <button
          type="button"
          tabindex="-1"
          class={cn(
            'absolute top-1/2 right-0.5 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground transition hover:bg-hover hover:text-foreground',
            !on && 'opacity-0 group-hover/tab:opacity-100 group-focus-visible/tab:opacity-100',
          )}
          aria-label={closeLabel?.(item) ?? `Close ${name(item)}`}
          onclick={(event) => {
            event.stopPropagation();
            close(id);
          }}
        >
          <X class="size-3" />
        </button>
      </div>
    {/each}
  </div>
  {#if after !== undefined}<span class="flex shrink-0 items-center pl-1">{@render after()}</span>{/if}
  <span class="flex-1"></span>
  {@render end?.()}
</div>

<DropdownMenu.Root bind:open={() => aimed !== null, (next) => !next && (aimed = null)}>
  <DropdownMenu.Content
    anchor={aimed === null ? undefined : { x: aimed.x, y: aimed.y }}
    class="w-52"
    align="start"
    sideOffset={0}
    data-tab-menu
  >
    {#if acts !== undefined && target !== null}
      {@render acts(target)}
      <DropdownMenu.Separator />
    {/if}
    <DropdownMenu.Item icon={X} onSelect={() => run(close)}>Close</DropdownMenu.Item>
    <DropdownMenu.Item icon={CopyX} onSelect={() => run(others)}>Close others</DropdownMenu.Item>
    <DropdownMenu.Item icon={ArrowRightToLine} onSelect={() => run(right)}>Close to the right</DropdownMenu.Item>
    <DropdownMenu.Item icon={ListX} onSelect={() => run(() => all())}>Close all</DropdownMenu.Item>
    {#if copies !== undefined && target !== null}
      <DropdownMenu.Separator />
      {@render copies(target)}
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
