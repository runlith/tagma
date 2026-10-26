<script lang="ts">
  import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal';
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { commitOf } from './paneContent.js';
  import { SHORT_SHA } from './reading.js';

  let { pane }: { pane: SidePane } = $props();

  const shown = $derived(commitOf(pane.id));
</script>

<GitCommitHorizontal class="size-3.5 shrink-0" />
<FadeText class="font-mono" text={shown === null ? 'Commit' : shown.sha.slice(0, SHORT_SHA)} />
