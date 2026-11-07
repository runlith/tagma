<script lang="ts">
  import type { SectionProps } from '$lib/features/settings/section.js';
  import AddField from '$lib/features/plugins/AddField.svelte';

  let { project }: SectionProps = $props();
</script>

{#if project !== null}
  <section class="mt-4 grid max-w-3xl gap-3 rounded-lg border p-3" aria-label="Add a provider">
    <div class="flex flex-wrap items-baseline gap-2">
      <h3 class="text-ui font-semibold">Add a provider</h3>
      <span class="text-ui text-muted-foreground">a plugin that brings models, a CLI agent or speech</span>
    </div>
    <AddField {project} scope="user" ondone={async () => undefined} oncancel={() => undefined} />
  </section>
{/if}
