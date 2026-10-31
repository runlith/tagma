<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import KeyCard from '$lib/features/settings/KeyCard.svelte';
  import { byBest, rank } from '@runlith/search-text/match';
  import { settingTarget } from '$lib/features/settings/match.js';
  import type { SettingsCatalog } from '$lib/features/settings/SettingsCatalog.svelte.js';

  let {
    query,
    sections,
    catalog,
    scopeOf,
    project,
  }: {
    query: string;
    sections: readonly { readonly id: string; readonly title: string }[];
    catalog: SettingsCatalog;
    scopeOf: (sectionId: string) => SettableScope;
    project: Project | null;
  } = $props();

  const ranked = $derived(rank(catalog.entries, query, settingTarget));

  const found = $derived(
    byBest(sections, ranked, (section, entry) => entry.section === section.id)
      .map((section) => ({ section, rows: ranked.filter(({ item }) => item.section === section.id).map(({ item }) => item) }))
      .filter((group) => group.rows.length > 0),
  );
</script>

{#if found.length === 0}
  <p class="pt-4 text-ui text-muted-foreground">
    No key matches “{query}”. The search reads a key's name, what it decides and its id; the sections this browser and this machine own are
    not declared keys and are not searched.
  </p>
{:else}
  {#each found as group (group.section.id)}
    <KeyCard title={group.section.title} entries={group.rows} {catalog} scope={scopeOf(group.section.id)} {project} />
  {/each}
{/if}
