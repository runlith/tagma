<script lang="ts">
  import type { SecretSet } from '@tagma/server/secrets/contract/wire/rows';
  import SecretFields from '$lib/features/secrets/SecretFields.svelte';

  let { set, projectId }: { set: SecretSet; projectId: number } = $props();
</script>

<section class="overflow-hidden rounded-lg border bg-raised" aria-label="{set.title} secrets">
  <div class="flex min-h-9 items-center gap-2 px-3 py-1">
    <h3 class="text-ui font-semibold">{set.title}</h3>
    <span class="text-ui text-muted-foreground">
      {set.missing === 0 ? 'every secret set' : `${set.missing} missing`}
    </span>
  </div>
  <SecretFields {set} {projectId} />
</section>
