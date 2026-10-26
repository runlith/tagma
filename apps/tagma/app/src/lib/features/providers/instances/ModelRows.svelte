<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import { rank } from '@runlith/search-text/match';
  import type { SettingField } from '@runlith/tagma/adapter/settings';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import FieldControl from './FieldControl.svelte';
  import { candidateRow, type Draft, emptyRow } from './draft.js';

  type Rows = Extract<SettingField, { readonly type: 'rows' }>;
  type Candidate = Readonly<Record<string, unknown>>;

  const SHOWN_CANDIDATES = 50;

  let {
    field,
    rows = $bindable(),
    discover,
  }: {
    field: Rows;
    rows: Draft[];
    discover: (() => Promise<readonly Candidate[] | null>) | null;
  } = $props();

  let candidates = $state<readonly Candidate[] | null>(null);
  let filter = $state('');
  let listing = $state(false);

  const idId = $derived(field.fields[0]?.id ?? 'id');
  const measure = $derived(field.fields.find((leaf) => leaf.type === 'number'));
  const listed = $derived(new Set(rows.map((row) => String(row[idId] ?? ''))));
  const offered = $derived(
    rank(
      (candidates ?? []).filter((candidate) => !listed.has(String(candidate[idId]))),
      filter,
      (candidate) => ({ name: String(candidate[idId]) }),
    ).map(({ item }) => item),
  );

  function summary(row: Draft): string {
    if (measure === undefined) return '';
    const given = String(row[measure.id] ?? '').trim();
    const unit = measure.type === 'number' ? (measure.unit ?? '') : '';
    return given === '' ? `${measure.label.toLowerCase()} missing` : `${given} ${unit}`.trim();
  }

  const added = (row: Draft, open: boolean): Draft => ({ ...row, _open: open });

  async function list(): Promise<void> {
    if (discover === null) return;
    listing = true;
    try {
      candidates = (await discover()) ?? candidates;
    } finally {
      listing = false;
    }
  }
</script>

<div class="grid gap-2">
  <div class="flex items-center gap-2">
    <span class="text-small text-muted-foreground">{field.label}</span>
    <span class="flex-1"></span>
    {#if discover !== null}
      <Button variant="outline" size="sm" disabled={listing} onclick={() => void list()}>
        {listing ? 'Listing…' : 'List from server'}
      </Button>
    {/if}
    <Button variant="outline" size="sm" onclick={() => rows.push(added(emptyRow(field), true))}>
      <Plus class="size-3.5" />
      Add {field.noun}
    </Button>
  </div>

  {#if candidates !== null}
    <div class="grid gap-1 rounded-md border bg-sunken p-2" data-candidates>
      <div class="flex items-center gap-2">
        <Input bind:value={filter} placeholder="Filter {candidates.length} listed" aria-label="Filter listed {field.noun}s" />
        <Button variant="ghost" size="icon-xs" aria-label="Close the list" onclick={() => (candidates = null)}>
          <X class="size-3.5" />
        </Button>
      </div>
      <div class="grid max-h-64 overflow-y-auto">
        {#each offered.slice(0, SHOWN_CANDIDATES) as candidate (candidate[idId])}
          <div class="flex items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-hover">
            <span class="min-w-0 flex-1 truncate font-mono text-ui">{candidate[idId]}</span>
            {#if measure !== undefined && typeof candidate[measure.id] === 'number'}
              <span class="text-meta text-muted-foreground"
                >{candidate[measure.id]} {measure.type === 'number' ? (measure.unit ?? '') : ''}</span
              >
            {/if}
            <Button
              variant="ghost"
              size="xs"
              aria-label="Add {candidate[idId]}"
              onclick={() =>
                rows.push(added(candidateRow(field, candidate), measure === undefined || typeof candidate[measure.id] !== 'number'))}
            >
              Add
            </Button>
          </div>
        {:else}
          <span class="px-1 py-0.5 text-small text-muted-foreground">
            {candidates.length === 0 ? `The server lists no ${field.noun}s.` : `Every listed ${field.noun} matching is already added.`}
          </span>
        {/each}
        {#if offered.length > SHOWN_CANDIDATES}
          <span class="px-1 py-0.5 text-meta text-muted-foreground">{offered.length - SHOWN_CANDIDATES} more: narrow the filter.</span>
        {/if}
      </div>
    </div>
  {/if}

  {#each rows as row, at (row._key)}
    <div class="rounded-md border" data-model-row>
      <div class="flex items-center gap-1 px-2 py-1">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-expanded={row._open === true}
          onclick={() => (row._open = row._open !== true)}
        >
          {#if row._open === true}<ChevronDown class="size-3.5 shrink-0" />{:else}<ChevronRight class="size-3.5 shrink-0" />{/if}
          <span class="min-w-0 truncate font-mono text-ui">{String(row[idId] ?? '') || `New ${field.noun}`}</span>
          <span class="shrink-0 text-meta text-muted-foreground">{summary(row)}</span>
        </button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Remove {String(row[idId] ?? '') || `the new ${field.noun}`}"
          onclick={() => rows.splice(at, 1)}
        >
          <X class="size-3.5" />
        </Button>
      </div>
      {#if row._open === true}
        <div class="grid grid-cols-2 gap-3 border-t px-2 py-2">
          {#each field.fields as leaf (leaf.id)}
            <div class={leaf.type === 'set' ? 'col-span-2' : ''}>
              <FieldControl field={leaf} bind:value={row[leaf.id]} />
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>
