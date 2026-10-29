<script lang="ts">
  import Group from '$lib/features/settings/Group.svelte';
  import OwnerSecrets from '$lib/features/secrets/OwnerSecrets.svelte';
  import { SecretsRepo } from '$lib/features/secrets/Repo.js';

  let { projectId }: { projectId: number } = $props();

  const secrets = SecretsRepo.use();
  const owned = $derived(secrets.sets.key({ projectId, owner: 'tagma-apps' }));
  const sets = $derived(owned.data ?? []);
  const failed = $derived(owned.error);
</script>

<Group title="Secrets">
  <div class="grid gap-3 pt-1">
    {#if failed}
      <p class="text-ui text-destructive">The secrets could not be read: {failed instanceof Error ? failed.message : String(failed)}</p>
    {:else if sets.length === 0}
      <p class="text-ui text-muted-foreground">
        No installed app declares secrets. An app lists them in <code class="stamp">contributes.secrets</code> of its
        <code class="stamp">tagma-app.json</code>.
      </p>
    {/if}
    {#each sets as set (set.id)}
      <OwnerSecrets {set} {projectId} />
    {/each}
  </div>
</Group>
