<script module lang="ts">
  import { SEARCH_DECORATIONS } from './canvasInk.js';

  export const FIND_QUERY_MAX_BYTES = 2 * 1024;

  export function searchQueryTooLarge(text: string): boolean {
    return text.length > FIND_QUERY_MAX_BYTES || new TextEncoder().encode(text).length > FIND_QUERY_MAX_BYTES;
  }

  export function safeFind(
    run: (term: string, options: TerminalSearchOptions) => boolean,
    term: string,
    options: TerminalSearchOptions,
    onProblem?: (problem: string) => void,
  ): boolean {
    try {
      return run(term, options);
    } catch (error) {
      reportFindThrow(error, onProblem);
      return false;
    }
  }

  const reportedFindThrows = new Set<string>();

  function reportFindThrow(error: unknown, onProblem?: (problem: string) => void): void {
    if (!onProblem) return;
    const message = error instanceof Error ? error.message : String(error);
    if (reportedFindThrows.has(message)) return;
    reportedFindThrows.add(message);
    onProblem(`searching the terminal failed and will be retried on the next keystroke (${message})`);
  }

  export interface TerminalSearchOptions {
    caseSensitive?: boolean;
    regex?: boolean;
    incremental?: boolean;
    decorations?: {
      matchBackground?: string;
      matchBorder?: string;
      matchOverviewRuler?: string;
      activeMatchBackground?: string;
      activeMatchBorder?: string;
      activeMatchColorOverviewRuler?: string;
    };
  }
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  export interface TerminalSearchAddon {
    findNext(term: string, options?: TerminalSearchOptions): boolean;
    findPrevious(term: string, options?: TerminalSearchOptions): boolean;
    clearDecorations(): void;
  }

  let {
    search,
    open,
    onClose,
    isMac,
    onProblem,
  }: {
    search: TerminalSearchAddon | null;
    open: boolean;
    onClose: () => void;
    isMac: boolean;
    onProblem?: (problem: string) => void;
  } = $props();

  let query = $state('');
  let caseSensitive = $state(false);
  let regex = $state(false);
  let input: HTMLInputElement | null = $state(null);
  let matched = $state<boolean | null>(null);

  const requestQuery = $derived(searchQueryTooLarge(query) ? null : query);
  const tooLong = $derived(searchQueryTooLarge(query));
  const verdict = $derived<'too-long' | 'none' | null>(tooLong ? 'too-long' : query === '' ? null : matched === false ? 'none' : null);

  function searchOptions(incremental: boolean): TerminalSearchOptions {
    return { caseSensitive, regex, incremental, decorations: SEARCH_DECORATIONS };
  }

  function clear(): void {
    if (!search) return;
    matched = null;
    search.clearDecorations();
    safeFind((term, options) => search.findNext(term, options), '', {}, onProblem);
  }

  function findNext(): void {
    if (search && requestQuery)
      matched = safeFind((term, options) => search.findNext(term, options), requestQuery, searchOptions(false), onProblem);
  }

  function findPrevious(): void {
    if (search && requestQuery)
      matched = safeFind((term, options) => search.findPrevious(term, options), requestQuery, searchOptions(false), onProblem);
  }

  function close(): void {
    clear();
    onClose();
  }

  $effect(() => {
    const addon = search;
    const shown = open;
    const wanted = requestQuery;
    const sensitive = caseSensitive;
    const pattern = regex;
    if (shown) input?.focus();
    if (!shown || !wanted || !addon) {
      clear();
      return;
    }
    matched = safeFind(
      (term, options) => addon.findNext(term, options),
      wanted,
      {
        caseSensitive: sensitive,
        regex: pattern,
        incremental: true,
        decorations: SEARCH_DECORATIONS,
      },
      onProblem,
    );
  });

  function navigateKey(event: KeyboardEvent): 'next' | 'previous' | null {
    if (event.altKey) return null;
    const held = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (!held || event.key.toLowerCase() !== 'g' || !requestQuery) return null;
    return event.shiftKey ? 'previous' : 'next';
  }

  function navigate(direction: 'next' | 'previous'): void {
    if (direction === 'next') findNext();
    else findPrevious();
  }

  $effect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      const direction = navigateKey(event);
      if (!direction) return;
      event.preventDefault();
      navigate(direction);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function onInputKeyDown(event: KeyboardEvent): void {
    const direction = navigateKey(event);
    if (direction) {
      event.preventDefault();
      event.stopPropagation();
      navigate(direction);
      return;
    }
    event.stopPropagation();
    if (event.key === 'Escape') close();
    else if (event.key === 'Enter' && event.shiftKey) findPrevious();
    else if (event.key === 'Enter') findNext();
  }

  onDestroy(() => clear());
</script>

{#if open}
  <div class="terminal-search" data-search-root role="search">
    <input
      data-search-input
      type="text"
      bind:value={query}
      bind:this={input}
      placeholder="Search..."
      autocomplete="off"
      spellcheck={false}
      onkeydown={onInputKeyDown}
    />
    {#if verdict !== null}
      <span class="verdict" data-search-verdict={verdict}>{verdict === 'too-long' ? 'Query too long' : 'No matches'}</span>
    {/if}
    <Tooltip text="Case sensitive">
      <button type="button" data-case-toggle aria-pressed={caseSensitive} onclick={() => (caseSensitive = !caseSensitive)}> Aa </button>
    </Tooltip>
    <Tooltip text="Regex">
      <button type="button" data-regex-toggle aria-pressed={regex} onclick={() => (regex = !regex)}> .* </button>
    </Tooltip>
    <Tooltip text="Previous match">
      <button type="button" data-prev onclick={findPrevious}>↑</button>
    </Tooltip>
    <Tooltip text="Next match">
      <button type="button" data-next onclick={findNext}>↓</button>
    </Tooltip>
    <Tooltip text="Close">
      <button type="button" data-close onclick={close}>✕</button>
    </Tooltip>
  </div>
{/if}

<style>
  .terminal-search {
    position: absolute;
    top: calc(var(--spacing) * 2);
    right: calc(var(--spacing) * 2);
    z-index: 50;
    display: flex;
    align-items: center;
    gap: var(--spacing);
    width: 300px;
    padding: var(--spacing) calc(var(--spacing) * 2);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--popover);
    box-shadow: var(--elevation-raised);
  }
  .terminal-search input {
    min-width: 0;
    flex: 1;
    border: none;
    background: transparent;
    color: var(--popover-foreground);
    font-size: var(--text-ui);
    outline: none;
  }
  .terminal-search button {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 24px;
    padding: 0 var(--spacing);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--muted-foreground);
    font-size: var(--text-small);
    cursor: pointer;
  }
  .terminal-search button:hover {
    color: var(--foreground);
  }
  .verdict {
    flex: none;
    color: var(--muted-foreground);
    font-size: var(--text-meta);
    white-space: nowrap;
  }
  .terminal-search button[aria-pressed='true'] {
    background: var(--accent);
    color: var(--accent-foreground);
  }
</style>
