<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import Group from '$lib/features/settings/Group.svelte';
  import type { SectionProps } from '$lib/features/settings/section.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import ChordControl from './ChordControl.svelte';
  import { REBIND } from './href.js';
  import { type Row, Shortcuts } from './Shortcuts.svelte.js';

  let {}: SectionProps = $props();

  const shortcuts = Shortcuts.use();
  const keymap = Keymap.use();
  const router = Router.use();

  let query = $state('');
  const rebind = $derived(router.url.searchParams.get(REBIND));
  const needle = $derived(query.trim().toLocaleLowerCase());

  const matches = (row: Row): boolean =>
    needle === '' ||
    row.listed.action.title.toLocaleLowerCase().includes(needle) ||
    (row.listed.action.keywords ?? []).some((word) => word.toLocaleLowerCase().includes(needle)) ||
    row.bound.some((binding) => keymap.spellChord(binding.chord).toLocaleLowerCase().includes(needle));

  const groups = $derived.by(() => {
    const byOwner = new Map<string, { readonly key: string; readonly title: string; readonly plugin: boolean; readonly rows: Row[] }>();
    for (const row of shortcuts.rows) {
      if (!matches(row)) continue;
      const owner = row.listed.action.by;
      const key = owner === undefined ? `area ${row.listed.area}` : `plugin ${owner.plugin}`;
      const group = byOwner.get(key) ?? { key, title: owner?.title ?? row.listed.area, plugin: owner !== undefined, rows: [] };
      group.rows.push(row);
      byOwner.set(key, group);
    }
    return [...byOwner.values()].toSorted((one, other) => Number(one.plugin) - Number(other.plugin));
  });

  const placeOf = (row: Row): string | null =>
    row.listed.action.region !== undefined ? row.listed.action.where : row.bound.some((binding) => binding.global) ? 'In every app' : null;

  $effect(() => {
    const aimed = rebind;
    if (aimed === null) return;
    requestAnimationFrame(() => document.querySelector(`[data-shortcut="${CSS.escape(aimed)}"]`)?.scrollIntoView({ block: 'center' }));
  });
</script>

<div class="grid">
  <div class="pt-4">
    <Input type="search" placeholder="Find an action or a chord" bind:value={query} aria-label="Find an action or a chord" />
  </div>
  {#if shortcuts.problem !== null}
    <p class="pt-3 text-small text-muted-foreground">{shortcuts.problem}</p>
  {/if}
  {#each groups as group (group.key)}
    <Group title={group.title}>
      {#each group.rows as row, index (row.keyed.id)}
        {@const place = placeOf(row)}
        <div
          class="grid gap-x-6 gap-y-2 border-vein py-3 @xl/settings:grid-cols-[minmax(0,1fr)_auto]"
          class:border-t={index > 0}
          data-shortcut={row.keyed.id}
        >
          <div class="grid min-w-0 content-start gap-0.5">
            <span class="text-ui">{row.listed.action.title}</span>
            {#if place !== null}<span class="text-small text-muted-foreground">{place}</span>{/if}
          </div>
          <div class="w-72 min-w-0 max-w-full">
            <ChordControl action={row.keyed.id} capturing={rebind === row.keyed.id} />
          </div>
        </div>
      {/each}
    </Group>
  {:else}
    <p class="py-3 text-ui text-muted-foreground">No action matches “{query}”.</p>
  {/each}
</div>
