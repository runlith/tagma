<script lang="ts">
  import { untrack } from 'svelte';
  import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import FinishDialog from '$lib/features/worktrees/FinishDialog.svelte';
  import { holdProject } from '$lib/features/workspace/holds.js';
  import type { TilePlaces } from './TilePlaces.svelte.js';

  let { projectId, tile }: { projectId: number; tile: TilePlaces } = $props();

  const home = untrack(() => projectId);
  const into = untrack(() => tile);
  holdProject(home);
  const places = Worktrees.use();
  $effect(() => into.hold(home, places));
</script>

<FinishDialog />
