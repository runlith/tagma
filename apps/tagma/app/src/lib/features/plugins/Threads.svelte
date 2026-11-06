<script lang="ts">
  import { PluginsRepo } from '$lib/features/plugins/Repo.js';
  import ThreadsPage from '$lib/features/plugins/ThreadsPage.svelte';

  let { projectId, plugin, home }: { projectId: number; plugin: string; home: string } = $props();

  const repo = PluginsRepo.use();
  const first = $derived(repo.threads.key({ projectId, id: plugin, cursor: null }));
</script>

{#if first.data !== undefined && first.data.threads.length > 0}
  <section class="grid gap-2" aria-label="Its threads">
    <h3 class="text-small font-medium text-muted-foreground">Its threads</h3>
    <div class="grid divide-y overflow-hidden rounded-lg border bg-raised">
      <ThreadsPage {projectId} {plugin} {home} cursor={null} before={0} />
    </div>
  </section>
{/if}
