<script lang="ts">
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import type { WorktreeTerminals } from '../worktrees/WorktreeTerminals.svelte.js';

  let { worktree }: { worktree: WorktreeTerminals } = $props();

  const workspace = Workspace.use();
  const pending = $derived(worktree.closing);
  const project = $derived(workspace.find(worktree.projectId)?.name ?? String(worktree.projectId));
  const thread = $derived(pending?.thread ?? null);
  let dontAskAgain = $state(false);

  $effect(() => {
    void pending?.key;
    dontAskAgain = false;
  });
</script>

<Dialog.Root
  open={pending !== null}
  onOpenChange={(next) => {
    if (!next) worktree.cancelClose();
  }}
>
  <Dialog.Content class="sm:max-w-sm">
    <Dialog.Header>
      {#if thread !== null}
        <Dialog.Title class="text-ui">End the thread’s CLI?</Dialog.Title>
        <Dialog.Description class="text-small" data-close-thread={thread.thread}>
          Closing this terminal ends the CLI of the thread “{thread.label}” running in it. The thread and its transcript stay.
        </Dialog.Description>
      {:else}
        <Dialog.Title class="text-ui">Stop running command?</Dialog.Title>
        <Dialog.Description class="text-small">Closing this terminal will stop the command running inside it.</Dialog.Description>
      {/if}
    </Dialog.Header>
    {#if pending !== null}
      <div class="grid gap-2 text-small">
        <p class="break-words text-muted-foreground">Project: {project}</p>
        {#if pending.label.trim() !== ''}<p class="break-words font-medium">{pending.label}</p>{/if}
        <ul class="grid max-h-60 gap-2 overflow-y-auto font-mono text-small">
          {#each pending.terminals as terminal (terminal)}
            <li class="break-all">{terminal}</li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if thread === null}
      <label class="flex items-center gap-2 text-small text-muted-foreground">
        <input type="checkbox" bind:checked={dontAskAgain} />
        Don't ask again for running terminals
      </label>
    {/if}
    <Dialog.Footer class="gap-2">
      <Button variant="outline" data-runlith-autofocus-ignore onclick={() => worktree.cancelClose()}>Cancel</Button>
      <Button variant="confirm" onclick={() => worktree.confirmClose(dontAskAgain)}>
        {thread === null ? 'Stop and Close' : 'End CLI and Close'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
