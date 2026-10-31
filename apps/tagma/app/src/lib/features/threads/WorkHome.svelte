<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { CommandActivity, type CommandView } from '$lib/features/executions/commands/Activity.svelte.js';
  import { holdProject } from '$lib/features/workspace/holds.js';

  let {
    projectId,
    threadId,
    view,
    children,
  }: { projectId: number; threadId: string; view: CommandView; children: Snippet<[CommandView]> } = $props();

  const home = untrack(() => view);
  const there = untrack(() => projectId);

  function held(): CommandView {
    holdProject(there);
    const words = home.words ?? { label: untrack(() => threadId), archived: false, harness: false };
    return CommandActivity.use().forThread(
      untrack(() => threadId),
      words,
    );
  }

  const shown = there === home.projectId ? home : held();
</script>

{@render children(shown)}
