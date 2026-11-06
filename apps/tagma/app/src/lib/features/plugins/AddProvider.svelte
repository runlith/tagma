<script lang="ts">
  import type { SectionProps } from '$lib/features/settings/section.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import AddField from '$lib/features/plugins/AddField.svelte';
  import { PLUGINS, placeOf } from '$lib/features/plugins/place.js';

  let { project }: SectionProps = $props();

  const addresses = Addresses.use();

  let added = $state<string | null>(null);
</script>

{#if project !== null}
  <section class="mt-4 grid max-w-3xl gap-3 rounded-lg border bg-raised p-3" aria-label="Add a provider">
    <div class="flex flex-wrap items-baseline gap-2">
      <h3 class="text-ui font-semibold">Add a provider</h3>
      <span class="text-ui text-muted-foreground">a plugin that brings models, a CLI agent or speech</span>
    </div>
    <AddField
      {project}
      scope="user"
      ondone={async (at) => {
        added = at;
      }}
      oncancel={() => (added = null)}
    />
    {#if added !== null && placeOf(added).kind === 'plugin'}
      <p class="text-small text-muted-foreground">
        Added. <a class="text-foreground underline" href={addresses.place(project.name, PLUGINS, added, null)}>Open its card</a>
      </p>
    {/if}
  </section>
{/if}
