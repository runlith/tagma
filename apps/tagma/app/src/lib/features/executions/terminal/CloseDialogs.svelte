<script lang="ts">
  import { TerminalTabs } from './Tabs.svelte.js';
  import CloseDialog from './CloseDialog.svelte';
  import Restore from './Restore.svelte';

  const tabs = TerminalTabs.use();
  const worktrees = $derived(tabs.all.flatMap((terminals) => terminals.all));
</script>

<Restore />

{#each worktrees as worktree (worktree)}
  <CloseDialog {worktree} />
{/each}
