<script lang="ts">
  import { Button } from '$lib/shared/ui/button/index.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { PluginsRepo } from '$lib/features/plugins/Repo.js';
  import Self from '$lib/features/plugins/ThreadsPage.svelte';

  let {
    projectId,
    plugin,
    home,
    cursor,
    before,
  }: { projectId: number; plugin: string; home: string; cursor: string | null; before: number } = $props();

  const addresses = Addresses.use();
  const repo = PluginsRepo.use();
  const page = $derived(repo.threads.key({ projectId, id: plugin, cursor }));

  let more = $state(false);
</script>

{#if page.data !== undefined}
  {#each page.data.threads as one (one.id)}
    <a href={addresses.thread(one.id, home)} class="px-3 py-2 transition-colors hover:bg-hover">
      <FadeText text={one.title === '' ? 'Untitled thread' : one.title} class="text-ui" />
    </a>
  {/each}
  {#if page.data.next !== null}
    {#if more}
      <Self {projectId} {plugin} {home} cursor={page.data.next} before={before + page.data.threads.length} />
    {:else}
      <div class="flex items-center justify-between gap-2 px-3 py-2">
        <span class="text-small text-muted-foreground">{page.data.total - before - page.data.threads.length} more</span>
        <Button variant="outline" size="xs" onclick={() => (more = true)}>Show more</Button>
      </div>
    {/if}
  {/if}
{/if}
