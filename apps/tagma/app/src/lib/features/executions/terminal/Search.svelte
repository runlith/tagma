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
    wholeWord?: boolean;
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

  export type TerminalSearchResults = { readonly resultIndex: number; readonly resultCount: number };
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import FindBar, { type FindTally } from '$lib/shared/ui/find/FindBar.svelte';

  export interface TerminalSearchAddon {
    findNext(term: string, options?: TerminalSearchOptions): boolean;
    findPrevious(term: string, options?: TerminalSearchOptions): boolean;
    clearDecorations(): void;
    onDidChangeResults(listener: (results: TerminalSearchResults) => void): { dispose(): void };
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
  let wholeWord = $state(false);
  let regex = $state(false);
  let matched = $state<boolean | null>(null);
  let results = $state.raw<TerminalSearchResults | null>(null);
  let bar = $state<FindBar>();
  let searchedWith = '';

  const tooLong = $derived(searchQueryTooLarge(query));
  const requestQuery = $derived(tooLong ? null : query);

  const tally = $derived.by((): FindTally => {
    if (tooLong) return { kind: 'refused', words: 'Query too long' };
    if (query === '') return { kind: 'idle' };
    if (results !== null && results.resultCount > 0)
      return {
        kind: 'counted',
        total: results.resultCount,
        current: results.resultIndex >= 0 ? results.resultIndex + 1 : null,
        more: results.resultIndex < 0,
      };
    if (results !== null || matched === false) return { kind: 'counted', total: 0, current: null, more: false };
    return { kind: 'idle' };
  });

  function searchOptions(incremental: boolean): TerminalSearchOptions {
    return { caseSensitive, wholeWord, regex, incremental, decorations: SEARCH_DECORATIONS };
  }

  function clear(): void {
    if (!search) return;
    matched = null;
    results = null;
    searchedWith = '';
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
    if (!addon) return;
    const heard = addon.onDidChangeResults((next) => (results = next));
    return () => heard.dispose();
  });

  $effect(() => {
    if (open) bar?.focus();
  });

  $effect(() => {
    const addon = search;
    const shown = open;
    const wanted = requestQuery;
    const sensitive = caseSensitive;
    const whole = wholeWord;
    const pattern = regex;
    if (!shown || !wanted || !addon) {
      clear();
      return;
    }
    const options = `${sensitive}:${whole}:${pattern}`;
    if (options !== searchedWith) addon.clearDecorations();
    searchedWith = options;
    matched = safeFind(
      (term, options) => addon.findNext(term, options),
      wanted,
      {
        caseSensitive: sensitive,
        wholeWord: whole,
        regex: pattern,
        incremental: true,
        decorations: SEARCH_DECORATIONS,
      },
      onProblem,
    );
  });

  $effect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.altKey) return;
      const held = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!held || event.key.toLowerCase() !== 'g' || !requestQuery) return;
      event.preventDefault();
      if (event.shiftKey) findPrevious();
      else findNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  onDestroy(() => clear());
</script>

{#if open}
  <div class="pointer-events-none absolute top-2 right-2 left-2 z-50 flex justify-end" data-search-root data-pane-prevent-terminal-focus>
    <FindBar
      bind:this={bar}
      class="pointer-events-auto"
      bind:search={query}
      bind:caseSensitive
      bind:wholeWord
      bind:regexp={regex}
      {tally}
      apple={isMac}
      onNext={findNext}
      onPrevious={findPrevious}
      onClose={close}
    />
  </div>
{/if}
