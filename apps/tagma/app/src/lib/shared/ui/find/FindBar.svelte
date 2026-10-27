<script module lang="ts">
  export type FindTally =
    | { readonly kind: 'idle' }
    | { readonly kind: 'refused'; readonly words: string }
    | { readonly kind: 'counted'; readonly total: number; readonly current: number | null; readonly more: boolean };
</script>

<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import Replace from '@lucide/svelte/icons/replace';
  import ReplaceAll from '@lucide/svelte/icons/replace-all';
  import X from '@lucide/svelte/icons/x';
  import { tick } from 'svelte';
  import type { ClassValue } from 'svelte/elements';
  import { spellChord } from '$lib/shared/chordSpelling.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { cn } from '$lib/shared/utils.js';
  import FindOptions from './FindOptions.svelte';

  let {
    search = $bindable(''),
    replacement = $bindable(''),
    caseSensitive = $bindable(),
    wholeWord = $bindable(),
    regexp = $bindable(),
    tally,
    apple,
    docked = false,
    class: className,
    onNext,
    onPrevious,
    onClose,
    onSelectAll,
    onReplace,
    onReplaceAll,
  }: {
    search?: string;
    replacement?: string;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regexp?: boolean;
    tally: FindTally;
    apple: boolean;
    docked?: boolean;
    class?: ClassValue;
    onNext: () => void;
    onPrevious: () => void;
    onClose: () => void;
    onSelectAll?: () => void;
    onReplace?: () => void;
    onReplaceAll?: () => void;
  } = $props();

  let searchField = $state<HTMLInputElement>();
  let replaceField = $state<HTMLInputElement>();
  let replacing = $state(false);

  const replaceable = $derived(onReplace !== undefined && onReplaceAll !== undefined);
  const refused = $derived(tally.kind === 'refused');
  const found = $derived(tally.kind === 'counted' && tally.total > 0);

  const words = $derived.by(() => {
    if (tally.kind === 'idle') return '';
    if (tally.kind === 'refused') return tally.words;
    if (tally.total === 0) return 'No results';
    const total = tally.more ? `${tally.total}+` : String(tally.total);
    if (tally.current !== null) return `${tally.current} of ${total}`;
    return tally.total === 1 && !tally.more ? '1 result' : `${total} results`;
  });

  const chord = (key: string, held: { mod?: boolean; alt?: boolean; shift?: boolean } = {}): string =>
    spellChord(
      { key, meta: apple && held.mod === true, ctrl: !apple && held.mod === true, alt: held.alt === true, shift: held.shift === true },
      apple,
    );

  export function focus(field: 'search' | 'replace' = 'search'): void {
    if (field === 'replace' && replaceable) {
      replacing = true;
      void tick().then(() => {
        replaceField?.focus();
        replaceField?.select();
      });
      return;
    }
    searchField?.focus();
    searchField?.select();
  }

  function fold(): void {
    if (replacing) {
      replacing = false;
      searchField?.focus();
      return;
    }
    focus('replace');
  }

  function actOf(event: KeyboardEvent): (() => void) | undefined {
    const mod = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (event.key === 'Escape') return onClose;
    if (event.key === 'F3' && !mod && !event.altKey) return event.shiftKey ? onPrevious : onNext;
    if (event.key === 'Enter' && event.target === replaceField) {
      if (mod && event.altKey) return onReplaceAll;
      return mod || event.altKey ? undefined : onReplace;
    }
    if (event.key === 'Enter' && event.target === searchField) {
      if (mod) return undefined;
      if (event.altKey) return onSelectAll;
      return event.shiftKey ? onPrevious : onNext;
    }
    if (!mod) return undefined;
    if (event.code === 'KeyG' && !event.altKey) return event.shiftKey ? onPrevious : onNext;
    if (event.code !== 'KeyF') return undefined;
    if (!event.altKey) return () => focus('search');
    return replaceable ? fold : undefined;
  }

  function keys(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const act = actOf(event);
    if (act === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    act();
  }

  const ROW = 'flex h-7 min-w-0 items-center gap-0.5';
  const FIELD =
    'flex h-7 min-w-0 flex-1 items-center gap-px rounded-md border border-input bg-sunken pr-0.5 pl-2 transition-colors focus-within:border-ring';
  const INPUT = 'h-full min-w-0 flex-1 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground';
  const ICON =
    'grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50';
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  role="search"
  onkeydown={keys}
  class={cn(
    docked
      ? 'grid shrink-0 gap-1 border-b bg-background px-1.5 py-1'
      : '@container grid w-100 max-w-full gap-1 rounded-lg border bg-popover p-1 text-popover-foreground shadow-raised',
    className,
  )}
  data-find
>
  <div class={ROW}>
    {#if replaceable}
      <Tooltip text="Toggle replace" keys={chord('f', { mod: true, alt: true })}>
        <button type="button" class={ICON} aria-label="Toggle replace" aria-expanded={replacing} data-find-fold onclick={fold}>
          <ChevronRight class={cn('size-3.5 transition-transform', replacing && 'rotate-90')} />
        </button>
      </Tooltip>
    {/if}
    <label class={cn(FIELD, docked && 'max-w-104', refused && 'border-destructive focus-within:border-destructive')}>
      <input
        bind:this={searchField}
        bind:value={search}
        class={INPUT}
        placeholder="Find"
        aria-label="Find"
        aria-invalid={refused}
        autocomplete="off"
        spellcheck={false}
        data-find-search
      />
      <FindOptions bind:caseSensitive bind:wholeWord bind:regexp />
    </label>
    <span
      class={cn(
        'min-w-19 shrink-0 px-1.5 text-small whitespace-nowrap tabular-nums @max-xs:min-w-0',
        refused ? 'text-destructive' : 'text-muted-foreground',
      )}
      aria-live="polite"
      data-find-tally>{words}</span
    >
    <Tooltip text="Previous match" keys={chord('Enter', { shift: true })}>
      <button type="button" class={ICON} aria-label="Previous match" disabled={!found} data-find-previous onclick={onPrevious}>
        <ChevronUp class="size-3.5" />
      </button>
    </Tooltip>
    <Tooltip text="Next match" keys={chord('Enter')}>
      <button type="button" class={ICON} aria-label="Next match" disabled={!found} data-find-next onclick={onNext}>
        <ChevronDown class="size-3.5" />
      </button>
    </Tooltip>
    <Tooltip text="Close" keys={chord('Escape')}>
      <button type="button" class={cn(ICON, docked && 'ml-auto')} aria-label="Close" data-find-close onclick={onClose}>
        <X class="size-3.5" />
      </button>
    </Tooltip>
  </div>
  {#if replaceable && replacing}
    <div class={ROW}>
      <span class="size-7 shrink-0"></span>
      <label class={cn(FIELD, docked && 'max-w-104')}>
        <input
          bind:this={replaceField}
          bind:value={replacement}
          class={INPUT}
          placeholder="Replace"
          aria-label="Replace"
          autocomplete="off"
          spellcheck={false}
          data-find-replace
        />
      </label>
      <Tooltip text="Replace" keys={chord('Enter')}>
        <button type="button" class={ICON} aria-label="Replace" disabled={!found} data-find-replace-one onclick={onReplace}>
          <Replace class="size-3.5" />
        </button>
      </Tooltip>
      <Tooltip text="Replace all" keys={chord('Enter', { mod: true, alt: true })}>
        <button type="button" class={ICON} aria-label="Replace all" disabled={!found} data-find-replace-all onclick={onReplaceAll}>
          <ReplaceAll class="size-3.5" />
        </button>
      </Tooltip>
      {#if !docked}<span class="w-26.5 shrink-0 @max-xs:w-0"></span>{/if}
    </div>
  {/if}
</div>
