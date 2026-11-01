<script lang="ts">
  import type { StagedCardProps } from '@tagma/app/points/staged';

  let { item }: StagedCardProps = $props();
</script>

<span data-testid="extension-card">{item.title}</span>
