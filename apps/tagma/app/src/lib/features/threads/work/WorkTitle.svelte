<script lang="ts">
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import KnowledgeIcon from '$lib/features/graph/KnowledgeIcon.svelte';

  let {}: { pane: SidePane } = $props();
</script>

<KnowledgeIcon class="size-3.5 shrink-0" />
<FadeText text="Work" />
