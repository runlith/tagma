<script lang="ts">
  import type { SectionProps } from '$lib/features/settings/section.js';

  let { scope }: SectionProps = $props();
</script>

<p data-testid="extension-note" data-scope={scope}>extension note</p>
