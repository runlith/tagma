<script lang="ts">
  import type { Neighbourhood, UnitRow } from '@tagma/server/enforcement/contract/wire/engines';
  import PathText from '$lib/shared/PathText.svelte';
  import { cn } from '$lib/shared/utils.js';

  let {
    modules,
    relations,
    focus,
    units,
    unitsTotal,
    more,
    onfocus,
  }: {
    modules: number;
    relations: number;
    focus: Neighbourhood | null;
    units: readonly UnitRow[];
    unitsTotal: number;
    more: (() => void) | null;
    onfocus: (module: string) => void;
  } = $props();

  const SHOWN = 10;

  let wide = $state(false);

  const entries = $derived(focus?.entries ?? []);
  const doors = $derived(wide ? entries : entries.slice(0, SHOWN));

  const home = $derived(focus?.territory.length === 1 && focus.territory[0]?.endsWith('/') ? focus.territory[0] : null);

  const inside = (at: string): string => (home !== null && at.startsWith(home) && at.length > home.length ? at.slice(home.length) : at);
</script>

{#snippet chip(id: string, role: string | undefined)}
  <button
    type="button"
    class="stamp rounded-md border border-vein-strong bg-raised px-2 py-1 text-meta transition-colors hover:border-foreground/40 hover:text-foreground"
    onclick={() => onfocus(id)}
  >
    {id}{role === undefined ? '' : ` · ${role}`}
  </button>
{/snippet}

<div class="grid gap-3">
  <p class="text-small text-muted-foreground">
    <span class="text-foreground">{modules}</span> modules ·
    <span class="text-foreground">{relations}</span> relations: who may import whom. A door is a place a module opens to the modules related to
    it.
  </p>

  {#if focus}
    <div class="grid justify-items-center gap-2 rounded-lg border border-vein bg-sunken/60 px-3 py-4">
      <span class="text-small text-muted-foreground">import from {focus.module}</span>
      <div class="flex flex-wrap justify-center gap-1.5">
        {#each focus.importedBy as one (one.from)}
          {@render chip(one.from, one.role)}
        {:else}
          <span class="text-small text-muted-foreground/70">nobody</span>
        {/each}
      </div>
      <span class="h-4 border-l border-vein-strong"></span>
      <div class="w-full max-w-md rounded-lg border border-vein-strong bg-raised px-4 py-3 text-center">
        <span class="stamp block text-page text-foreground">{focus.module}</span>
        <span class="mt-0.5 block text-small text-muted-foreground">
          {focus.entries === null
            ? 'open whole'
            : focus.entries.length === 0
              ? 'no doors: open to no module'
              : `${focus.entries.length} ${focus.entries.length === 1 ? 'door' : 'doors'}`}
        </span>
        <div class="mt-2 grid gap-0.5 text-left">
          {#each focus.territory as place (place)}
            <PathText class="stamp text-meta text-foreground/80" title={place} path={place} />
          {/each}
        </div>
        {#if entries.length > 0}
          <div class="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-vein pt-2 text-left text-small">
            {#each doors as door (door.at)}
              <PathText
                class={cn('stamp', door.role === 'testing' ? 'text-muted-foreground' : 'text-status-verified')}
                title={door.at}
                path={inside(door.at)}
              />
              <span class="text-right text-muted-foreground"
                >{door.role === 'testing' ? 'tests only' : door.for === undefined ? 'every related' : `for ${door.for.join(', ')}`}</span
              >
            {/each}
          </div>
          {#if entries.length > SHOWN}
            <button type="button" class="mt-1 text-small text-muted-foreground hover:text-foreground" onclick={() => (wide = !wide)}>
              {wide ? 'fewer' : `+${entries.length - SHOWN} more`}
            </button>
          {/if}
        {/if}
      </div>
      <span class="h-4 border-l border-vein-strong"></span>
      <div class="flex flex-wrap justify-center gap-1.5">
        {#each focus.imports as one (one.to)}
          {@render chip(one.to, one.role)}
        {:else}
          <span class="text-small text-muted-foreground/70">nothing</span>
        {/each}
      </div>
      <span class="text-small text-muted-foreground">{focus.module} imports from</span>
    </div>
  {/if}

  <div class="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-1">
    {#each units as unit (unit.id)}
      <button
        type="button"
        class={cn(
          'flex min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-small transition-colors hover:bg-hover',
          focus?.module === unit.id && 'bg-selected text-foreground',
        )}
        onclick={() => onfocus(unit.id)}
      >
        <span class="stamp min-w-0 truncate" title={unit.id}>{unit.id}</span>
        <span class="shrink-0 text-muted-foreground tabular">{unit.imports}↓ {unit.importedBy}↑</span>
      </button>
    {/each}
  </div>
  {#if more !== null}
    <button type="button" class="justify-self-start text-ui text-muted-foreground hover:text-foreground" onclick={() => more?.()}>
      Show {unitsTotal - units.length} more modules
    </button>
  {/if}
</div>
