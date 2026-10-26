<script lang="ts">
  import FadeText from '$lib/shared/FadeText.svelte';
  import FileIcon from '$lib/shared/FileIcon.svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { fileTargetOf } from './paneContent.js';

  let { pane }: { pane: SidePane } = $props();

  const path = $derived(fileTargetOf(pane.id)?.path ?? '');
  const name = $derived(path.slice(path.lastIndexOf('/') + 1) || 'File');
</script>

<FileIcon {path} />
<FadeText text={name} />
