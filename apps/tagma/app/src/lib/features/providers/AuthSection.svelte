<script lang="ts">
  import AuthPanel from '$lib/features/providers/AuthPanel.svelte';
  import type { SectionProps } from '$lib/features/settings/section.js';

  let { project }: SectionProps = $props();
</script>

<AuthPanel projectId={project?.id ?? null} />
