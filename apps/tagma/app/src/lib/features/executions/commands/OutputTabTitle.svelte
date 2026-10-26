<script lang="ts">
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import TerminalIcon from '../TerminalIcon.svelte';
  import { CommandActivity } from './Activity.svelte.js';
  import { outputTabOf } from './outputTab.js';

  let { pane }: { pane: SidePane } = $props();

  const activity = CommandActivity.use();
  const tab = $derived(outputTabOf(pane.id));
  const line = $derived(tab === null ? null : activity.line(tab.key));
</script>

<TerminalIcon class="size-3.5 shrink-0" />
<FadeText class="flex-1 font-mono" text={line?.label ?? line?.command ?? 'Command'} />
