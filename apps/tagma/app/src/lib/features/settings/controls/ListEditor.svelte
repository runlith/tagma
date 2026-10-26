<script lang="ts">
  import type { SettingMerge } from '@tagma/server/platform/contract/wire/setting';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import { glide, Reorder } from '$lib/shared/Reorder.svelte.js';
  import { Button } from '$lib/shared/ui/button/index.js';

  let {
    label,
    own,
    inherited,
    merge,
    declined,
    layerName,
    disabled = false,
    onwrite,
    ondecline,
  }: {
    label: string;
    own: readonly unknown[] | undefined;
    inherited: readonly unknown[];
    merge: SettingMerge;
    declined: boolean;
    layerName: string;
    disabled?: boolean;
    onwrite: (value: readonly string[]) => void;
    ondecline: (declined: boolean) => void;
  } = $props();

  const merges = $derived(merge !== 'replace');
  const mine = $derived<readonly unknown[]>(own ?? (merges ? [] : inherited));
  const ghosts = $derived<readonly unknown[]>(merges && !declined ? inherited : []);

  const asLines = $derived(mine.every((member) => typeof member === 'string'));

  let draft = $state<string[]>([]);
  let dirty = $state(false);

  const reorder = new Reorder(
    () => draft.map((_, index) => index),
    (from, before) => place(from, before),
    'y',
  );

  const stored = $derived(mine.map((member) => (typeof member === 'string' ? member : JSON.stringify(member))));
  const blank = $derived(draft.some((line) => line.trim() === ''));

  $effect(() => {
    const incoming = stored;
    if (!dirty) draft = [...incoming];
  });

  function edit(next: string[]): void {
    draft = next;
    dirty = true;
  }

  function save(): void {
    if (blank) return;
    dirty = false;
    onwrite(draft.map((line) => line.trim()));
  }

  function cancel(): void {
    dirty = false;
    draft = [...stored];
  }

  function place(from: number, before: number | null): void {
    const next = [...draft];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(before === null ? next.length : before > from ? before - 1 : before, 0, moved);
    edit(next);
  }
</script>

<div class="grid w-full gap-1.5 @xl/settings:w-72">
  {#if ghosts.length > 0}
    <div class="grid gap-1">
      {#each ghosts as entry, index (index)}
        <div
          class="flex items-center gap-2 rounded-lg border border-dashed border-vein px-2 py-1 font-mono text-small text-muted-foreground"
        >
          <span class="min-w-0 flex-1 truncate">{typeof entry === 'string' ? entry : JSON.stringify(entry)}</span>
          <span class="eyebrow shrink-0">Inherited</span>
        </div>
      {/each}
    </div>
  {/if}

  <div class="relative grid gap-1" {@attach reorder.attach}>
    {#each reorder.arranged( draft.map((line, index) => ({ line, index })), (entry) => entry.index ) as { line, index } (index)}
      {@const carried = reorder.carried === index}
      <div
        class={[
          'flex items-center gap-1.5 rounded-lg border px-1.5 py-1',
          carried ? 'relative z-10 bg-background shadow-raised' : 'transition-transform',
        ]}
        class:border-destructive={line.trim() === ''}
        style:translate={reorder.offset(index)}
        data-reorder-item={index}
        data-reorder-handle={!disabled && asLines ? index : undefined}
        data-carried={carried || undefined}
        animate:glide
        role="listitem"
      >
        {#if asLines}
          <GripVertical class="size-3.5 shrink-0 cursor-grab text-muted-foreground/60" />
          <input
            class="min-w-0 flex-1 bg-transparent font-mono text-small outline-none"
            aria-label="{label} {index + 1}"
            spellcheck="false"
            {disabled}
            value={line}
            oninput={(event) => edit(draft.map((was, at) => (at === index ? (event.currentTarget as HTMLInputElement).value : was)))}
          />
        {:else}
          <span class="min-w-0 flex-1 truncate px-1 font-mono text-small">{line}</span>
        {/if}
        <button
          type="button"
          class="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
          aria-label="Remove {line}"
          {disabled}
          onclick={() => edit(draft.filter((_, at) => at !== index))}
        >
          <X class="size-3.5" />
        </button>
      </div>
    {/each}
    {#if draft.length === 0}
      <p class="px-1 text-small text-muted-foreground">
        {ghosts.length > 0 ? `Nothing of ${layerName}'s own` : 'Nothing yet'}
      </p>
    {/if}
  </div>

  <div class="flex flex-wrap items-center justify-between gap-2">
    {#if asLines}
      <button
        type="button"
        class="flex items-center gap-1 rounded-md px-1 py-0.5 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
        {disabled}
        onclick={() => edit([...draft, ''])}
      >
        <Plus class="size-3" />
        Add
      </button>
    {:else}
      <span class="text-small text-muted-foreground">Written as declarations; entries may only be removed here.</span>
    {/if}
    {#if dirty}
      <div class="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" {disabled} onclick={cancel}>Cancel</Button>
        <Button size="sm" disabled={disabled || blank} onclick={save}>Save</Button>
      </div>
    {/if}
  </div>

  {#if blank}
    <p class="text-small text-destructive">An empty line is not a value: fill it in or remove it.</p>
  {/if}

  {#if merges}
    <label class="flex items-center gap-2 text-small text-muted-foreground">
      <input
        type="checkbox"
        class="size-3.5 accent-primary"
        checked={declined}
        {disabled}
        onchange={(event) => ondecline((event.currentTarget as HTMLInputElement).checked)}
      />
      Only {layerName}'s — ignore what stands beneath
    </label>
  {/if}
</div>
