<script lang="ts">
  import type { SettingControl, SettingField } from '@tagma/server/platform/contract/wire/setting';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import { getContext, tick } from 'svelte';
  import { MODEL_FIELD, type ModelFieldComponent } from '$lib/features/settings/controls/modelField.js';
  import {
    blankRow,
    fieldApplies,
    readPath,
    rowsToEdit,
    settleRow,
    writePath,
    type Row,
    type RowNote,
  } from '$lib/features/settings/controls/rows.js';
  import { glide, Reorder } from '$lib/shared/Reorder.svelte.js';
  import { Button } from '$lib/shared/ui/button/index.js';

  let {
    control,
    own,
    inherited,
    merging,
    declined,
    disabled = false,
    rowNote,
    onwrite,
    ondecline,
  }: {
    control: Extract<SettingControl, { kind: 'rows' }>;
    own: readonly unknown[] | undefined;
    inherited: readonly unknown[];
    merging: boolean;
    declined: boolean;
    disabled?: boolean;
    rowNote?: (row: Row) => RowNote | null;
    onwrite: (value: readonly unknown[]) => void;
    ondecline: (declined: boolean) => void;
  } = $props();

  const ModelField = getContext<ModelFieldComponent | undefined>(MODEL_FIELD);

  let frame = $state<HTMLDivElement | null>(null);

  const reorder = new Reorder(
    () => draft.map((_, index) => index),
    (from, before) => move(from, before === null ? draft.length - 1 : before > from ? before - 1 : before),
    'y',
  );

  function move(from: number, to: number): void {
    if (from === to || to < 0 || to >= draft.length) return;
    const next = [...draft];
    const [row] = next.splice(from, 1);
    if (row === undefined) return;
    next.splice(to, 0, row);
    draft = next;
    dirty = true;
  }

  const mine = $derived<readonly Row[]>((own ?? (merging ? [] : inherited)) as readonly Row[]);
  const ghosts = $derived<readonly Row[]>(merging && !declined ? (inherited as readonly Row[]) : []);

  let draft = $state<Row[]>([]);
  let dirty = $state(false);

  $effect(() => {
    draft = rowsToEdit({ own, inherited, merging });
    dirty = false;
  });

  function edit(index: number, next: Row): void {
    draft = draft.map((row, at) => (at === index ? next : row));
    dirty = true;
  }

  function remove(index: number): void {
    draft = draft.filter((_, at) => at !== index);
    dirty = true;
  }

  function add(): void {
    draft = [...draft, blankRow(control.fields)];
    dirty = true;
  }

  function save(): void {
    onwrite(draft.map((row) => settleRow(control.fields, row)));
    dirty = false;
  }

  function cancel(): void {
    draft = rowsToEdit({ own, inherited, merging });
    dirty = false;
  }

  function scalarFields(row: Row): readonly SettingField[] {
    return control.fields.filter((field) => field.kind !== 'model' && fieldApplies(field, row));
  }
</script>

{#snippet record(row: Row, index: number | null)}
  {@const held = index !== null}
  {@const note = rowNote?.(row) ?? null}
  <div class="grid gap-1.5 rounded-lg border border-vein bg-sunken/40 p-2" class:opacity-60={!held} role="listitem">
    <div class="flex items-start gap-1.5">
      {#if held}
        <button
          type="button"
          class="mt-1 cursor-grab rounded-sm text-muted-foreground/60 hover:text-foreground disabled:cursor-default"
          aria-label="Move this entry — arrow keys move it up or down"
          {disabled}
          data-reorder-handle={!disabled && draft.length > 1 ? index : undefined}
          data-row-grip={index}
          onkeydown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            const to = index + (event.key === 'ArrowUp' ? -1 : 1);
            if (to < 0 || to >= draft.length) return;
            move(index, to);
            void tick().then(() => frame?.querySelector<HTMLElement>(`[data-row-grip="${to}"]`)?.focus());
          }}
        >
          <GripVertical class="size-3.5" />
        </button>
      {/if}
      <div class="min-w-0 flex-1">
        {#each control.fields.filter((field) => field.kind === 'model') as field (field.label)}
          {#if ModelField !== undefined}
            <ModelField
              label={field.label}
              provider={String(readPath(row, [field.path[0]]) ?? '')}
              model={String(readPath(row, [field.path[1]]) ?? '')}
              disabled={disabled || !held}
              onpick={(provider, model) => {
                if (index === null) return;
                edit(index, writePath(writePath(row, [field.path[0]], provider), [field.path[1]], model));
              }}
            />
          {/if}
        {/each}
      </div>
      {#if held}
        <button
          type="button"
          class="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
          aria-label="Remove this entry"
          {disabled}
          onclick={() => remove(index)}
        >
          <X class="size-3.5" />
        </button>
      {/if}
    </div>

    {#if note !== null}
      <p class={['pl-5 text-small', note.tone === 'ready' ? 'text-muted-foreground' : 'text-severity-gap']} data-row-note={note.tone}>
        {note.text}
      </p>
    {/if}

    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-5">
      {#each scalarFields(row) as field (field.path.join('.'))}
        {#if field.kind === 'choice'}
          <div class="flex items-center gap-1.5">
            <span class="text-small text-muted-foreground">{field.label}</span>
            <div class="inline-flex overflow-hidden rounded-md border border-vein">
              {#each field.choices as choice (choice.value)}
                <button
                  type="button"
                  class={[
                    'px-2 py-0.5 text-small transition-colors',
                    readPath(row, field.path) === choice.value
                      ? 'bg-selected text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  ]}
                  title={choice.hint}
                  disabled={disabled || !held}
                  onclick={() => {
                    if (index === null) return;
                    edit(index, writePath(row, field.path, choice.value));
                  }}
                >
                  {choice.label}
                </button>
              {/each}
            </div>
          </div>
        {:else if field.kind === 'share'}
          {@const share = Number(readPath(row, field.path) ?? field.maximum)}
          <div class="flex items-center gap-1.5">
            <span class="text-small text-muted-foreground">{field.label}</span>
            <input
              class="w-14 rounded-md border border-vein bg-background px-1.5 py-0.5 text-right font-mono text-meta"
              type="number"
              min={Math.round(field.minimum * 100)}
              max={Math.round(field.maximum * 100)}
              step="1"
              value={Math.round(share * 100)}
              disabled={disabled || !held}
              onchange={(event) => {
                if (index === null) return;
                const typed = Math.min(
                  Math.round(field.maximum * 100),
                  Math.max(Math.round(field.minimum * 100), Number(event.currentTarget.value) || 90),
                );
                edit(index, writePath(row, field.path, typed / 100));
              }}
            />
            <span class="text-small text-muted-foreground">%</span>
          </div>
        {:else if field.kind === 'text'}
          <label class="flex w-full items-center gap-1.5">
            <span class="w-28 shrink-0 text-small text-muted-foreground">{field.label}</span>
            <input
              class="min-w-0 flex-1 rounded-md border border-vein bg-background px-1.5 py-0.5 text-small"
              type="text"
              placeholder={field.placeholder}
              value={String(readPath(row, field.path) ?? '')}
              disabled={disabled || !held}
              oninput={(event) => {
                if (index === null) return;
                const typed = event.currentTarget.value;
                edit(index, writePath(row, field.path, typed === '' ? undefined : typed));
              }}
            />
          </label>
        {/if}
      {/each}
    </div>
  </div>
{/snippet}

<div class="grid min-w-0 gap-2" bind:this={frame}>
  {#if ghosts.length > 0}
    <div class="grid gap-1.5">
      {#each ghosts as row, index (index)}
        {@render record(row, null)}
      {/each}
      <p class="px-0.5 text-small text-muted-foreground">
        Standing beneath this layer: a thread reads these unless this layer's rows answer for the same pair.
      </p>
    </div>
  {/if}

  {#if draft.length > 0}
    <div class="relative grid gap-2" {@attach reorder.attach}>
      {#each reorder.arranged( draft.map((row, index) => ({ row, index })), (entry) => entry.index ) as { row, index } (index)}
        {@const carried = reorder.carried === index}
        <div
          class={['rounded-lg', carried ? 'relative z-10 bg-background shadow-raised' : 'transition-transform']}
          style:translate={reorder.offset(index)}
          data-reorder-item={index}
          data-carried={carried || undefined}
          animate:glide
        >
          {@render record(row, index)}
        </div>
      {/each}
    </div>
  {:else}
    <div class="rounded-lg border border-dashed border-vein px-2 py-3 text-center text-small text-muted-foreground">Nothing yet</div>
  {/if}

  <div class="flex items-center justify-between gap-2">
    <Button variant="ghost" size="sm" {disabled} onclick={add}>
      <Plus class="size-3.5" /> Add
    </Button>
    {#if dirty}
      <div class="flex items-center gap-2">
        <Button variant="ghost" size="sm" {disabled} onclick={cancel}>Cancel</Button>
        <Button size="sm" {disabled} onclick={save}>Save</Button>
      </div>
    {/if}
  </div>

  {#if merging}
    <label class="flex items-center gap-1.5 text-small text-muted-foreground">
      <input type="checkbox" checked={declined} {disabled} onchange={(event) => ondecline(event.currentTarget.checked)} />
      Only this layer's — ignore what stands beneath
    </label>
  {/if}
</div>
