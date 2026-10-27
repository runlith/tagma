<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import { untrack } from 'svelte';
  import FileIcon from '$lib/shared/FileIcon.svelte';
  import PathText from '$lib/shared/PathText.svelte';
  import FindOptions from '$lib/shared/ui/find/FindOptions.svelte';
  import { Input } from '$lib/shared/ui/input/index.js';
  import { cn } from '$lib/shared/utils.js';
  import { Column } from './Column.svelte.js';
  import { Explorer } from './Explorer.svelte.js';
  import { FileOpener } from './FileOpener.svelte.js';
  import { FileSearch } from './FileSearch.svelte.js';
  import { kindFor } from './tab.js';
  import { Tabs } from './Tabs.svelte.js';

  const search = FileSearch.use();
  const tabs = Tabs.use();
  const opener = FileOpener.use();
  const explorer = Explorer.use();
  const column = Column.use();

  let field = $state<HTMLInputElement | null>(null);
  let narrowing = $state(false);

  $effect(() => {
    void column.focusing;
    untrack(() => {
      if (column.view !== 'search') return;
      field?.focus();
      field?.select();
    });
  });

  const PAGE = 300;

  let limit = $state(PAGE);

  $effect(() => {
    void search.pattern;
    void search.regex;
    void search.caseSensitive;
    void search.wholeWord;
    void search.include;
    void search.exclude;
    limit = PAGE;
  });

  const shown = $derived(search.rows(limit));

  function show(file: string, line: number, range: { readonly start: number; readonly end: number } | undefined): void {
    const rootId = explorer.rootId;
    if (rootId === null) return;
    const column = range?.start ?? 0;
    const length = range === undefined ? 0 : range.end - range.start;
    void opener.view({ path: file }, { project: tabs.projectId, root: rootId }, () => {
      tabs.open(
        { rootId, path: file, kind: kindFor(file, true), goto: { line: line - 1, column, length: length > 0 ? length : undefined } },
        'preview',
      );
    });
  }

  function pieces(
    preview: string,
    ranges: readonly { readonly start: number; readonly end: number }[],
  ): readonly { text: string; hit: boolean }[] {
    const out: { text: string; hit: boolean }[] = [];
    let at = 0;
    for (const range of ranges) {
      if (range.start > at) out.push({ text: preview.slice(at, range.start), hit: false });
      out.push({ text: preview.slice(range.start, range.end), hit: true });
      at = range.end;
    }
    if (at < preview.length) out.push({ text: preview.slice(at), hit: false });
    return out;
  }
</script>

<div class="flex min-h-0 flex-1 flex-col" data-files-search>
  <div class="grid shrink-0 gap-1 px-2 py-1.5">
    <div class="relative">
      <Input
        bind:ref={field}
        bind:value={search.pattern}
        placeholder="Search"
        aria-label="Search in files"
        class="pr-16"
        data-search-input
      />
      <span class="absolute inset-y-0 right-1 flex items-center gap-px">
        <FindOptions bind:caseSensitive={search.caseSensitive} bind:wholeWord={search.wholeWord} bind:regexp={search.regex} />
      </span>
    </div>
    <div class="flex items-center justify-between gap-2">
      <button
        type="button"
        class="flex items-center gap-1 text-small text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={narrowing}
        onclick={() => (narrowing = !narrowing)}
      >
        <Ellipsis class="size-3.5" />Files to include and exclude
      </button>
    </div>
    {#if narrowing}
      <Input bind:value={search.include} placeholder="Include, e.g. src/**, *.ts" aria-label="Files to include" data-search-include />
      <Input bind:value={search.exclude} placeholder="Exclude, e.g. **/*.test.ts" aria-label="Files to exclude" data-search-exclude />
    {/if}
  </div>
  {#if search.failure !== null}
    <p class="px-3 py-1 text-small text-destructive" data-search-failure>{search.failure}</p>
  {:else if search.pattern !== ''}
    <p class="px-3 pb-1 text-small text-muted-foreground" data-search-summary>
      {#if search.searching || search.done === null}
        Searching… {search.files} {search.files === 1 ? 'file' : 'files'}
      {:else if search.done.matches === 0}
        No results
      {:else if search.done.truncated}
        At least {search.done.matches} results in {search.done.files} {search.done.files === 1 ? 'file' : 'files'}: narrow the search
      {:else}
        {search.done.matches}
        {search.done.matches === 1 ? 'result' : 'results'} in {search.done.files}
        {search.done.files === 1 ? 'file' : 'files'}
      {/if}
    </p>
  {/if}
  <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2">
    {#each shown.rows as row (row.kind === 'file' ? row.file : `${row.file}\u0000${row.match.line}`)}
      {#if row.kind === 'file'}
        <button
          type="button"
          class="flex h-6 w-full min-w-0 items-center gap-1.5 px-2 text-left text-ui transition-colors hover:bg-hover"
          aria-expanded={!row.folded}
          onclick={() => search.fold(row.file)}
          data-search-file={row.file}
        >
          {#if row.folded}<ChevronRight class="size-3 shrink-0 text-muted-foreground" />{:else}<ChevronDown
              class="size-3 shrink-0 text-muted-foreground"
            />{/if}
          <FileIcon path={row.file} />
          <PathText class="flex-1" path={row.file} directoryClass="text-muted-foreground" />
          <span class="shrink-0 font-mono text-meta tabular-nums text-muted-foreground">{row.count}</span>
        </button>
      {:else}
        <button
          type="button"
          class="flex h-6 w-full min-w-0 items-baseline gap-2 pr-2 pl-8 text-left text-small transition-colors hover:bg-hover"
          onclick={() => show(row.file, row.match.line, row.match.ranges[0])}
          data-search-match={row.match.line}
        >
          <span class="shrink-0 font-mono text-meta tabular-nums text-muted-foreground/60">{row.match.line}</span>
          <span class="min-w-0 flex-1 truncate font-mono text-muted-foreground">
            {#each pieces(row.match.preview, row.match.ranges) as piece, index (index)}
              <span class={cn(piece.hit && 'rounded-sm bg-selected text-foreground')}>{piece.text}</span>
            {/each}
          </span>
        </button>
      {/if}
    {/each}
    {#if shown.more}
      <button
        type="button"
        class="flex h-6 w-full items-center px-3 text-left text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        onclick={() => (limit += PAGE)}
        data-search-more
      >
        Show more results
      </button>
    {/if}
  </div>
</div>
