<script lang="ts">
  import AuthPanel from '$lib/features/providers/AuthPanel.svelte';
  import type { SectionProps } from '$lib/features/settings/section.js';

  let {}: SectionProps = $props();
</script>

<AuthPanel />
