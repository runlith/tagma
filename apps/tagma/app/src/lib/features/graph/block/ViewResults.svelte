<script lang="ts">
  import { GROUP_FIELDS, type BlockQuery, type GroupField, type ViewLayout, VIEW_LAYOUT } from '@tagma/server/graph/contract/wire/query';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import LayoutIcon from '@lucide/svelte/icons/layout-list';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import type { BlockListRow, ViewResults } from '@tagma/server/graph/contract/wire/reads';
  import type { BlockRead } from '@tagma/server/graph/contract/wire/rows';
  import BlockRow from '$lib/features/graph/outline/BlockRow.svelte';
  import FilterBar from '$lib/features/graph/FilterBar.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import type { ReadingLens } from '$lib/features/graph/ReadingLens.svelte.js';
  import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
  import { statusLabel } from '$lib/features/graph/status.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { barTrigger, cn } from '$lib/shared/utils.js';

  const blocks = BlocksRepo.use();
  const tags = TagCatalog.use();
  const addresses = Addresses.use();

  const READING_MODES = ['list', 'sections', 'board'] as const;
  const READING_LABEL: Record<(typeof READING_MODES)[number], string> = {
    list: 'One list',
    sections: 'Sections',
    board: 'Columns',
  };

  let {
    block,
    query,
    results,
    lens,
  }: {
    block: BlockRead;
    query: BlockQuery;
    results: ViewResults;
    lens: ReadingLens;
  } = $props();

  const shown = $derived(results.items.filter((row) => lens.matches(row)));

  let saved = $state<ViewLayout | null>(null);
  const layout = $derived(saved ?? tags.layoutOf(block));

  type QueryTerm = { label: string; value: string };

  const terms = $derived.by(() => {
    const out: QueryTerm[] = [];
    for (const [field, value] of Object.entries(query)) {
      if (typeof value === 'boolean') out.push({ label: value ? field : `not ${field}`, value: '' });
      else out.push({ label: field, value: termValue(field, value) });
    }
    return out;
  });

  function termValue(field: string, value: unknown): string {
    if (Array.isArray(value)) return value.map((item) => (field === 'scope' ? `${item}` : String(item))).join(', ');
    if (field === 'edge') {
      const edge = value as { kind: string; to?: number; from?: number };
      return edge.to === undefined ? `← ${edge.kind} ${edge.from}` : `→ ${edge.kind} ${edge.to}`;
    }
    if (field === 'sort') {
      const sort = value as { by: string; order: string };
      return `${sort.by} ${sort.order}`;
    }
    return typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value);
  }

  function groupOf(row: BlockListRow, by: GroupField): string | null {
    if (by === 'status') return tags.statusOf(row);
    if (by === 'tag') return tags.tagOf(row);
    return row.parentTitle;
  }

  function groupOrder(by: GroupField, keys: string[]): string[] {
    const declared = by === 'status' ? tags.statuses : by === 'tag' ? tags.declared : null;
    if (declared === null) return keys;
    const known = declared.filter((word) => keys.includes(word));
    return [...known, ...keys.filter((key) => !known.includes(key))];
  }

  const groups = $derived.by(() => {
    if (layout === null || layout.mode === 'list') return null;
    const grouped = new Map<string, BlockListRow[]>();
    const ungrouped: BlockListRow[] = [];
    for (const row of shown) {
      const key = groupOf(row, layout.by);
      if (key === null) {
        ungrouped.push(row);
        continue;
      }
      const bucket = grouped.get(key);
      if (bucket) bucket.push(row);
      else grouped.set(key, [row]);
    }
    const ordered = groupOrder(layout.by, [...grouped.keys()]).map((key) => ({
      key: `value:${key}`,
      label: layout.by === 'status' ? statusLabel(key) : key.trim() || 'Untitled',
      rows: grouped.get(key) ?? [],
    }));
    if (ungrouped.length === 0) return ordered;
    const none = layout.by === 'status' ? 'no status' : layout.by === 'tag' ? 'no tag' : 'no parent';
    return [...ordered, { key: 'none', label: none, rows: ungrouped }];
  });

  const missing = $derived(results.missingScope.map((id) => `${id}`).join(', '));

  const groupedByParent = $derived(layout?.mode !== 'list' && layout?.by === 'parent');

  const mode = $derived(layout?.mode ?? 'list');
  const by = $derived(layout === null || layout.mode === 'list' ? 'tag' : layout.by);
  let saving = $state(false);

  function readAs(next: string): void {
    const reading = READING_MODES.find((one) => one === next);
    if (reading !== undefined) void setLayout(reading === 'list' ? { mode: 'list' } : { mode: reading, by });
  }

  function groupBy(next: string): void {
    const field = GROUP_FIELDS.find((one) => one === next);
    if (field !== undefined && mode !== 'list') void setLayout({ mode, by: field });
  }

  async function setLayout(next: ViewLayout): Promise<void> {
    saving = true;
    try {
      const row = await blocks.update.run({ name: block.name, changes: { fields: { [VIEW_LAYOUT]: next } } }, { throwOnError: true });
      if (row) saved = tags.layoutOf(row);
    } finally {
      saving = false;
    }
  }
</script>

<div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
  {#each terms as term (term.label)}
    <span
      class="inline-flex h-[19px] shrink-0 items-center gap-1 rounded-full border border-vein bg-sunken/60 px-2 text-small leading-none text-muted-foreground"
    >
      <span>{term.label}</span>
      {#if term.value}<span class="font-medium tabular text-foreground/85">{term.value}</span>{/if}
    </span>
  {/each}
  {#if results.total > results.items.length}
    <span class="ml-auto stamp tabular text-muted-foreground/60">{results.items.length} of {results.total}</span>
  {/if}
</div>

<div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
  <FilterBar {lens} sort={false} />

  <div class="flex h-7 items-center gap-0.5" class:opacity-60={saving}>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class={barTrigger(mode !== 'list')} disabled={saving}>
        <LayoutIcon class="size-3.5" />
        {READING_LABEL[mode]}
        <ChevronDown class="size-3 opacity-50" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" class="min-w-40">
        <DropdownMenu.RadioGroup value={mode} onValueChange={readAs}>
          {#each READING_MODES as reading (reading)}
            <DropdownMenu.RadioItem value={reading}>{READING_LABEL[reading]}</DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>

    {#if mode !== 'list'}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class={barTrigger(true)} disabled={saving}>
          by {by}
          <ChevronDown class="size-3 opacity-50" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" class="min-w-36">
          <DropdownMenu.RadioGroup value={by} onValueChange={groupBy}>
            {#each GROUP_FIELDS as field (field)}
              <DropdownMenu.RadioItem value={field}>{field}</DropdownMenu.RadioItem>
            {/each}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </div>

  {#if lens.active}
    <span class="ml-auto stamp tabular text-muted-foreground/60">{shown.length} of {results.items.length} shown</span>
  {/if}
</div>

{#if results.missingScope.length > 0}
  <p class="mt-3 rounded-lg border border-severity-lie/30 bg-severity-lie/5 px-3 py-2 text-ui text-muted-foreground">
    {results.missingScope.length === 1 ? 'The scope' : 'The scopes'}
    {missing}
    {results.missingScope.length === 1 ? 'no longer stands' : 'no longer stand'}, so this view answers nothing rather than reading wider
    than it was cut.
  </p>
{:else if results.items.length === 0}
  <p class="mt-3 text-ui text-muted-foreground">Nothing in the graph matches this slice.</p>
{:else if shown.length === 0}
  <p class="mt-3 text-ui text-muted-foreground">The lens hides every row this slice answered.</p>
{:else if groups && mode === 'sections'}
  <div class="mt-4 flex flex-col gap-6">
    {#each groups as group (group.key)}
      <section>
        <div class="sticky top-0 z-10 flex items-baseline gap-1.5 border-b border-vein bg-background/95 pb-1 backdrop-blur-sm">
          <span class="eyebrow text-muted-foreground">{group.label}</span>
          <span class="stamp tabular text-muted-foreground/60">{group.rows.length}</span>
        </div>
        <div class="mt-1.5">
          {#each group.rows as row (row.name)}
            {@render resultRow(row)}
          {/each}
        </div>
      </section>
    {/each}
  </div>
{:else if groups}
  <div class="mt-3 -mx-2 overflow-x-auto px-2">
    <div class="grid auto-cols-[minmax(min-content,1fr)] grid-flow-col gap-x-5">
      {#each groups as column (column.key)}
        <div class="min-w-0">
          <div class="flex items-baseline gap-1.5 border-b border-vein pb-1">
            <span class="eyebrow min-w-0 truncate text-muted-foreground">{column.label}</span>
            <span class="stamp tabular text-muted-foreground/60">{column.rows.length}</span>
          </div>
          <div class="mt-1 flex flex-col gap-1">
            {#each column.rows as row (row.name)}
              {@render resultRow(row, true)}
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
{:else}
  <div class="mt-3">
    {#each shown as row (row.name)}
      {@render resultRow(row)}
    {/each}
  </div>
{/if}

{#snippet resultRow(row: BlockListRow, boarded = false)}
  <BlockRow block={row} href={addresses.block(row.name)} layout={boarded ? 'stacked' : 'line'}>
    {#snippet title()}
      <span
        class={cn(
          'min-w-0 flex-1 py-px text-body leading-6 break-words select-none',
          // A column is narrow enough that a long word would leave a ragged hole; the document declares its language, so the browser can hyphenate.
          boarded && 'hyphens-auto',
          tags.isResting(row) && 'text-muted-foreground',
          tags.restingState(row) === 'closed' && 'line-through decoration-muted-foreground/40',
        )}
      >
        <span class={cn(!row.title.trim() && 'text-muted-foreground')}>{row.title.trim() || 'Untitled'}</span>
        {#if row.parentTitle && !groupedByParent}<span class="text-muted-foreground/60"> · {row.parentTitle}</span>{/if}
      </span>
    {/snippet}
  </BlockRow>
{/snippet}
