<script lang="ts">
  import Group from '$lib/features/settings/Group.svelte';
  import type { SectionProps } from '$lib/features/settings/section.js';
  import PluginSecrets from '$lib/features/plugin-secrets/PluginSecrets.svelte';
  import { SecretsRepo } from '$lib/features/plugin-secrets/Repo.js';

  let { project }: SectionProps = $props();

  const secrets = SecretsRepo.use();
  const projectId = $derived(project?.id);
  const sets = $derived(projectId === undefined ? [] : (secrets.plugins.key(projectId).data ?? []));
  const failed = $derived(projectId === undefined ? undefined : secrets.plugins.key(projectId).error);
</script>

{#if projectId !== undefined}
  <Group title="Secrets">
    <div class="grid gap-3 pt-1">
      {#if failed}
        <p class="text-ui text-destructive">The secrets could not be read: {failed instanceof Error ? failed.message : String(failed)}</p>
      {:else if sets.length === 0}
        <p class="text-ui text-muted-foreground">
          No installed plugin declares secrets. A plugin lists them in <code class="stamp">contributes.secrets</code> of its
          <code class="stamp">plugin.json</code>.
        </p>
      {/if}
      {#each sets as set (set.plugin)}
        <PluginSecrets {set} {projectId} />
      {/each}
    </div>
  </Group>
{/if}
