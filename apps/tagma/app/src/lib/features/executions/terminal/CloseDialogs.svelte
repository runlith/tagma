<script lang="ts">
  import { Terminals } from '../worktrees/Terminals.svelte.js';
  import CloseDialog from './CloseDialog.svelte';

  const terminals = Terminals.use();
</script>

{#each terminals.all as worktree (worktree)}
  <CloseDialog {worktree} />
{/each}
