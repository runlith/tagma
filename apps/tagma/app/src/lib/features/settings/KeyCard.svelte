<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import type { Snippet } from 'svelte';
  import { foundReader } from '$lib/features/settings/found.js';
  import Group from '$lib/features/settings/Group.svelte';
  import SettingRow from '$lib/features/settings/SettingRow.svelte';
  import type { Row, RowNote } from '$lib/features/settings/controls/rows.js';
  import { Router } from '@runlith/layer/Router';
  import { scopeLock, scopeName, scopeOverride } from '$lib/features/settings/scope.js';
  import type { SettingEntry, SettingsCatalog } from '$lib/features/settings/SettingsCatalog.svelte.js';

  let {
    title,
    fact,
    act,
    foot,
    entries,
    dimmed = [],
    rowNotes = {},
    catalog,
    scope,
    project,
  }: {
    title?: string;
    fact?: Snippet;
    act?: Snippet;
    foot?: Snippet;
    entries: readonly SettingEntry[];
    dimmed?: readonly string[];
    rowNotes?: Readonly<Record<string, (row: Row) => RowNote | null>>;
    catalog: SettingsCatalog;
    scope: SettableScope;
    project: Project | null;
  } = $props();

  const router = Router.use();

  const layerName = $derived(scopeName(scope, project));
  const readFound = foundReader();
  const found = $derived(readFound());

  function write(entry: SettingEntry, value: unknown): void {
    void catalog.write({ scope, key: entry.id, value });
  }

  function decline(entry: SettingEntry, declined: boolean): void {
    const own = catalog.answerOf(entry, scope).own;
    void catalog.write({ scope, key: entry.id, declined, value: own });
  }
</script>

<Group {title} {fact} {act}>
  {#each entries as entry, index (entry.id)}
    <div
      class={['-mx-3 rounded-md px-3 transition-colors duration-500', found === entry.id && 'bg-selected']}
      class:opacity-50={dimmed.includes(entry.id)}
      data-setting={entry.id}
    >
      <div class="border-vein" class:border-t={index > 0}>
        <SettingRow
          {entry}
          {scope}
          {layerName}
          answer={catalog.answerOf(entry, scope)}
          busy={catalog.busyKey === entry.id}
          outcome={catalog.outcomes[entry.id]}
          locked={scopeLock(router, entry, scope, project)}
          override={scopeOverride(router, entry, catalog.answerOf(entry, scope), project)}
          rowNote={rowNotes[entry.id]}
          onwrite={(value) => write(entry, value)}
          onclear={() => void catalog.write({ scope, key: entry.id })}
          ondecline={(declined) => decline(entry, declined)}
        />
      </div>
    </div>
  {/each}

  {#if entries.length === 0 && foot === undefined}
    <p class="py-3 text-ui text-muted-foreground">No keys stand here.</p>
  {/if}

  {#if foot}
    <div class="mt-2 rounded-md bg-sunken px-3 py-3">{@render foot()}</div>
  {/if}
</Group>
