<script lang="ts">
  import { rowWords, type TeamModel, type TeamModelEdit } from '@runlith/agent/collaboration/team';
  import { TEAM_WORK, type TeamWork } from '@runlith/llm/models/description';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import X from '@lucide/svelte/icons/x';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import TileMeter from '$lib/shared/ui/TileMeter.svelte';
  import Chips from '$lib/shared/ui/Chips.svelte';
  import Stepper from './Stepper.svelte';
  import { type Rating, ratingBase, ratingEdited, type RowField, type RowFields } from './edits.js';
  import { AXES, favorWords, rowName, signedWords, WORK_CHOICES } from './words.js';

  let {
    row,
    edit,
    below,
    offered,
    disabled = false,
    onwrite,
    onremove,
  }: {
    row: TeamModel;
    edit: TeamModelEdit | undefined;
    below: TeamModelEdit | undefined;
    offered: boolean;
    disabled?: boolean;
    onwrite: (set: RowFields, drop: readonly RowField[]) => void;
    onremove: () => void;
  } = $props();

  const RATED: readonly RowField[] = ['open', 'depth', 'taste', 'ui', 'spend', 'favor', 'only', 'not', 'note', 'operatorOnly'];
  const BELOW = 'Every project’s';
  const TAGMA = 'Tagma’s';

  const providers = ProviderCatalog.use();
  const name = $derived(rowName(providers.models, row));
  const sets = (field: RowField): boolean => edit?.[field] !== undefined;
  const differs = $derived(row.shipped !== null && RATED.some(sets));

  function baseOf(field: RowField): unknown {
    const machine = below?.[field];
    if (machine !== undefined) return machine;
    if (row.shipped === null) return undefined;
    return field === 'favor' ? 0 : row.shipped[field as keyof typeof row.shipped];
  }

  const same = (left: unknown, right: unknown): boolean =>
    Array.isArray(left) && Array.isArray(right)
      ? left.length === right.length && left.every((one, at) => one === right[at])
      : left === right;

  function apply(fields: RowFields): void {
    const set: Record<string, unknown> = {};
    const drop: RowField[] = [];
    for (const [field, value] of Object.entries(fields) as [RowField, unknown][]) {
      const base = baseOf(field);
      if (base !== undefined && same(value, base)) drop.push(field);
      else set[field] = value;
    }
    onwrite(set as RowFields, drop);
  }

  function rate(field: Rating, value: number): void {
    const fields: Partial<Record<Rating, number>> = {};
    fields[field] = value;
    apply(fields);
  }

  function work(kind: 'only' | 'not', value: TeamWork): void {
    const other = kind === 'only' ? 'not' : 'only';
    const chosen = row[kind];
    const next = chosen.includes(value)
      ? chosen.filter((one) => one !== value)
      : TEAM_WORK.filter((one) => one === value || chosen.includes(one));
    const rest = row[other].filter((one) => one !== value);
    apply(kind === 'only' ? { only: next, not: rest } : { not: next, only: rest });
  }

  function note(typed: string): void {
    const text = typed.trim();
    if (text !== (row.note ?? '')) apply({ note: text === '' ? null : text });
  }
</script>

<div class="mt-1 mb-3 ml-8 grid gap-3 rounded-lg border bg-raised p-3 shadow-raised" data-team-card>
  <div class="flex min-h-6 items-center gap-1.5">
    <span class="text-ui font-semibold">{name.label}</span>
    {#if name.rung !== null}<span class="text-ui text-muted-foreground">{name.rung}</span>{/if}
    <span class="ml-2 text-small text-muted-foreground">{providers.modeName(row.provider)}</span>
    <span class="flex-1"></span>
    {#if differs}
      <Button variant="ghost" size="xs" {disabled} onclick={() => onwrite({}, RATED)}>
        <RotateCcw class="size-3.5" />Reset to Tagma’s
      </Button>
    {/if}
    <Button variant="ghost" size="xs" class="hover:bg-hover-danger hover:text-destructive" {disabled} onclick={onremove}>
      <X class="size-3.5" />Remove
    </Button>
  </div>

  {#if row.shipped === null}
    <p class="text-small text-muted-foreground">Tagma ships no rating for this model: the numbers are yours alone.</p>
  {/if}

  <div class="grid gap-0.5">
    {#each AXES as axis (axis.field)}
      {@const base = ratingBase(below, row, axis.field)}
      {@const edited = ratingEdited(edit, below, row, axis.field)}
      <div class="flex min-h-7 items-center gap-3">
        <span class="w-14 shrink-0 text-ui font-medium">{axis.label}</span>
        <FadeText class="flex-1 text-small text-muted-foreground" text={axis.hint} />
        <TileMeter count={10} lit={row[axis.field]} />
        <Stepper
          label={`${axis.label} — ${name.label}`}
          value={row[axis.field]}
          minimum={1}
          maximum={10}
          {edited}
          {disabled}
          onchange={(value) => rate(axis.field, value)}
        />
        <span class="flex w-24 shrink-0 justify-end">
          {#if edited && base !== null}
            <button
              type="button"
              class="rounded-sm px-1.5 py-1 font-mono text-meta text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
              title="Drop this edit"
              {disabled}
              onclick={() => onwrite({}, [axis.field])}
            >
              {base.below ? BELOW : TAGMA}
              {base.value}
            </button>
          {/if}
        </span>
      </div>
    {/each}
  </div>

  <div class="h-px bg-border"></div>

  <div class="flex min-h-7 items-center gap-3">
    <span class="w-20 shrink-0 text-ui font-medium">Preference</span>
    <Stepper
      label={`Preference — ${name.label}`}
      value={row.favor}
      minimum={-5}
      maximum={5}
      words={signedWords}
      {disabled}
      onchange={(favor) => apply({ favor })}
    />
    <span class="w-16 shrink-0 text-small">{favorWords(row.favor)}</span>
    <span class="min-w-0 flex-1 text-small text-muted-foreground">
      Tilts how often agents take it, ratings untouched: to spare an account or use a model more.
    </span>
  </div>
  <div class="flex min-h-7 items-center gap-3">
    <span class="w-20 shrink-0 text-ui font-medium">Only for</span>
    <Chips
      label="Only for"
      choices={WORK_CHOICES}
      chosen={(one) => row.only.includes(one)}
      {disabled}
      onpress={(one) => work('only', one)}
    />
  </div>
  <div class="flex min-h-7 items-center gap-3">
    <span class="w-20 shrink-0 text-ui font-medium">Never for</span>
    <Chips
      label="Never for"
      choices={WORK_CHOICES}
      chosen={(one) => row.not.includes(one)}
      {disabled}
      onpress={(one) => work('not', one)}
    />
  </div>
  <div class="flex min-h-7 items-center gap-3">
    <span class="w-20 shrink-0 text-ui font-medium">Note</span>
    <input
      class="h-7 w-72 rounded-md border border-vein bg-field px-2 text-small outline-none placeholder:text-muted-foreground focus:border-vein-strong disabled:opacity-50"
      type="text"
      placeholder="up to six words agents read"
      aria-label={`Note — ${name.label}`}
      value={row.note ?? ''}
      {disabled}
      onchange={(event) => note(event.currentTarget.value)}
    />
  </div>
  <div class="flex min-h-7 items-center gap-3">
    <span class="w-20 shrink-0 text-ui font-medium">Your word</span>
    <label class="flex items-center gap-2 text-small">
      <input
        type="checkbox"
        checked={row.operatorOnly}
        {disabled}
        onchange={(event) => apply({ operatorOnly: event.currentTarget.checked })}
      />
      Only when I name it
    </label>
    <span class="text-small text-muted-foreground">Agents never pick it on their own.</span>
  </div>

  <div class="h-px bg-border"></div>

  <div class="flex items-start gap-3">
    <span class="w-20 shrink-0 pt-1.5 text-ui font-medium">Agents read</span>
    {#if offered}
      <code
        class="block min-w-0 flex-1 rounded-md bg-sunken px-3 py-1.5 font-mono text-meta break-words whitespace-pre-wrap"
        data-team-reads>{rowWords(row)}</code
      >
    {:else}
      <p class="min-w-0 flex-1 rounded-md bg-sunken px-3 py-1.5 text-small text-muted-foreground" data-team-reads>
        Agents are not offered this model: check Work or Review on its row.
      </p>
    {/if}
  </div>
</div>
