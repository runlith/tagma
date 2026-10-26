<script lang="ts">
  import { Button } from '$lib/shared/ui/button/index.js';

  let {
    paths,
    project,
    reason,
    onSave,
    onDiscard,
    onCancel,
  }: {
    paths: readonly string[];
    project: string;
    reason: string | null;
    onSave: (() => void) | undefined;
    onDiscard: () => void;
    onCancel: () => void;
  } = $props();
</script>

<div class="w-96 rounded-lg border bg-popover p-4 text-popover-foreground shadow-float" data-unsaved-dialog>
  {#if reason === null}
    <h2 class="text-ui font-semibold">Save changes?</h2>
    <p class="mt-2 text-ui text-muted-foreground">The changes are lost if you do not save them.</p>
  {:else}
    <h2 class="break-words text-ui font-semibold">Not saved: {reason}</h2>
    <p class="mt-2 text-ui text-muted-foreground">
      {paths.length === 1 ? 'This file keeps' : 'These files keep'} changes the disk does not have. Close without saving?
    </p>
  {/if}
  <p class="mt-2 break-words text-small text-muted-foreground">Project: {project}</p>
  <ul class="mt-2 grid max-h-60 gap-2 overflow-y-auto font-mono text-small">
    {#each paths as path, index (index)}
      <li class="break-all">{path}</li>
    {/each}
  </ul>
  <div class="mt-4 flex justify-end gap-2">
    <Button variant="ghost" size="sm" onclick={onCancel}>{reason === null ? 'Cancel' : 'Keep open'}</Button>
    <Button variant={reason === null ? 'outline' : 'confirm'} size="sm" onclick={onDiscard}>
      {reason === null ? "Don't save" : 'Close without saving'}
    </Button>
    {#if onSave !== undefined}
      <Button size="sm" onclick={onSave}>Save</Button>
    {/if}
  </div>
</div>
