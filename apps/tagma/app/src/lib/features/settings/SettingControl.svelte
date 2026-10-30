<script lang="ts">
  import type { AskChoice } from '@tagma/server/platform/contract/wire/setting';
  import { Input } from '$lib/shared/ui/input/index.js';
  import CatalogPicker from '$lib/features/settings/controls/CatalogPicker.svelte';
  import ChoiceControl from '$lib/features/settings/controls/ChoiceControl.svelte';
  import ChoiceSetControl from '$lib/features/settings/controls/ChoiceSetControl.svelte';
  import ColorSlots from '$lib/features/settings/controls/ColorSlots.svelte';
  import { colorsOf } from '$lib/features/settings/controls/colors.js';
  import ListEditor from '$lib/features/settings/controls/ListEditor.svelte';
  import ModelPick from '$lib/features/settings/controls/ModelPick.svelte';
  import QuantityControl from '$lib/features/settings/controls/QuantityControl.svelte';
  import RowsControl from '$lib/features/settings/controls/RowsControl.svelte';
  import type { Row, RowNote } from '$lib/features/settings/controls/rows.js';
  import ShareControl from '$lib/features/settings/controls/ShareControl.svelte';
  import StopsControl from '$lib/features/settings/controls/StopsControl.svelte';
  import SwitchControl from '$lib/features/settings/controls/SwitchControl.svelte';
  import type { SettingAnswer, SettingEntry } from './SettingsCatalog.svelte.js';

  let {
    entry,
    answer,
    layerName,
    describedBy,
    disabled = false,
    rowNote,
    onwrite,
    ondecline,
  }: {
    entry: SettingEntry;
    answer: SettingAnswer;
    layerName: string;
    describedBy?: string;
    disabled?: boolean;
    rowNote?: (row: Row) => RowNote | null;
    onwrite: (value: unknown) => void;
    ondecline: (declined: boolean) => void;
  } = $props();

  const shown = $derived(answer.own === undefined ? answer.inherited : answer.own);

  const managed = $derived(entry.control?.kind === 'managed' ? entry.control : null);
  const managedRows = $derived(Array.isArray(shown) ? (shown as { name?: unknown }[]) : []);

  const STOPS_WORTH_DRAWING = 9;
  const stops = $derived.by(() => {
    const control = entry.control;
    if (control?.kind !== 'slider') return null;
    const count = (control.maximum - control.minimum) / control.step + 1;
    if (!Number.isInteger(count) || count < 2 || count > STOPS_WORTH_DRAWING) return null;
    return Array.from({ length: count }, (_, index) => control.minimum + index * control.step);
  });
</script>

<div class={['flex min-w-0 items-center gap-2', entry.control?.kind === 'rows' ? 'w-full' : '@xl/settings:justify-end']}>
  {#if managed}
    <div class="grid min-w-0 gap-1 @xl/settings:w-64 @xl/settings:justify-items-end">
      {#if managedRows.length === 0}
        <span class="text-small text-muted-foreground">None declared</span>
      {:else}
        <div class="flex min-w-0 flex-wrap gap-1 @xl/settings:justify-end">
          {#each managedRows as row, index (typeof row.name === 'string' ? row.name : index)}
            <span class="stamp rounded-md border border-vein bg-sunken/60 px-1.5 py-0.5 text-meta text-foreground/80">
              {typeof row.name === 'string' ? row.name : JSON.stringify(row)}
            </span>
          {/each}
        </div>
      {/if}
      <code class="stamp text-meta text-muted-foreground">{managed.by}</code>
    </div>
  {:else if entry.control?.kind === 'ask'}
    <ModelPick
      label={entry.title}
      ask={entry.control.of}
      value={(shown ?? null) as AskChoice | null}
      blank="Automatic"
      {disabled}
      onpick={onwrite}
      onautomatic={() => onwrite(null)}
    />
  {:else if typeof shown === 'boolean'}
    <SwitchControl label={entry.title} value={shown} {disabled} {onwrite} />
  {:else if entry.control?.kind === 'choice' && entry.control.multiple}
    <ChoiceSetControl label={entry.title} choices={entry.control.choices} value={shown} fallback={entry.fallback} {disabled} {onwrite} />
  {:else if entry.control?.kind === 'choice'}
    <ChoiceControl
      label={entry.title}
      choices={entry.control.choices}
      value={shown}
      fallback={entry.fallback}
      {describedBy}
      {disabled}
      {onwrite}
    />
  {:else if entry.control?.kind === 'catalog'}
    <CatalogPicker label={entry.title} of={entry.control.of} value={shown} fallback={entry.fallback} {disabled} {onwrite} />
  {:else if entry.control?.kind === 'colors'}
    <ColorSlots label={entry.title} groups={entry.control.groups} value={colorsOf(shown)} {disabled} {onwrite} />
  {:else if stops}
    <StopsControl label={entry.title} {stops} value={shown} fallback={entry.fallback} {disabled} {onwrite} />
  {:else if entry.control?.kind === 'share'}
    <ShareControl
      label={entry.title}
      value={shown}
      minimum={entry.control.minimum}
      maximum={entry.control.maximum}
      fallback={entry.fallback}
      reference={entry.control.reference}
      {disabled}
      {onwrite}
    />
  {:else if entry.control?.kind === 'number'}
    <QuantityControl
      label={entry.title}
      value={shown}
      unit={entry.control.unit}
      minimum={entry.control.minimum}
      maximum={entry.control.maximum}
      step={entry.control.step}
      {disabled}
      {onwrite}
    />
  {:else if entry.control?.kind === 'rows'}
    <RowsControl
      control={entry.control}
      own={answer.own as readonly unknown[] | undefined}
      inherited={(Array.isArray(answer.inherited) ? answer.inherited : []) as readonly unknown[]}
      merging={entry.merge !== 'replace'}
      declined={answer.declined}
      {disabled}
      {rowNote}
      {onwrite}
      {ondecline}
    />
  {:else if Array.isArray(shown)}
    <ListEditor
      label={entry.title}
      own={answer.own as readonly unknown[] | undefined}
      inherited={(Array.isArray(answer.inherited) ? answer.inherited : []) as readonly unknown[]}
      merge={entry.merge}
      declined={answer.declined}
      {layerName}
      {disabled}
      {onwrite}
      {ondecline}
    />
  {:else if entry.control?.kind === 'slider'}
    {@const span = entry.control.maximum - entry.control.minimum}
    <div class="grid w-48 shrink-0 gap-1">
      <output class="text-right font-mono text-small text-foreground">{String(shown)}</output>
      <input
        type="range"
        class="knob w-full cursor-pointer disabled:cursor-default"
        style="--filled: {((Number(shown) - entry.control.minimum) / span) * 100}%"
        aria-label={entry.title}
        min={entry.control.minimum}
        max={entry.control.maximum}
        step={entry.control.step}
        value={Number(shown)}
        {disabled}
        onchange={(event) => onwrite(Number((event.currentTarget as HTMLInputElement).value))}
      />
      <div class="flex items-center justify-between text-small text-muted-foreground">
        <span>{entry.control.minimum}</span>
        <span>{entry.control.maximum}</span>
      </div>
    </div>
  {:else}
    <Input
      class="@xl/settings:w-64"
      value={String(shown ?? '')}
      {disabled}
      onchange={(event) => onwrite((event.currentTarget as HTMLInputElement).value)}
    />
  {/if}
</div>
