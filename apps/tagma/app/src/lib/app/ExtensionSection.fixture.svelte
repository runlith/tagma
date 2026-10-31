<script lang="ts">
  import type { SectionProps } from '$lib/features/settings/section.js';

  let { scope }: SectionProps = $props();
</script>

<p data-testid="extension-section" data-scope={scope}>extension section</p>
