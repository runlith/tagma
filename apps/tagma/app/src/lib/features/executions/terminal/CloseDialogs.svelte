<script lang="ts">
  import { Terminals } from '../worktrees/Terminals.svelte.js';
  import CloseDialog from './CloseDialog.svelte';

  const terminals = Terminals.use();
</script>

{#each [...terminals.worktrees.values()] as worktree (worktree.rootId)}
  <CloseDialog {worktree} />
{/each}
