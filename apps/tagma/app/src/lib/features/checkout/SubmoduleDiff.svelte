<script lang="ts">
  import FolderGit2 from '@lucide/svelte/icons/folder-git-2';
  import type { SubmoduleDiff } from '@tagma/server/change-record/contract/wire/authorship';
  import type { DiffEnds } from './diffEnds.js';

  let { change, ends }: { change: SubmoduleDiff; ends: DiffEnds } = $props();
  const changed = $derived(
    change.before.kind !== change.after.kind ||
      (change.before.kind === 'commit' && change.after.kind === 'commit' && change.before.oid !== change.after.oid),
  );
  const title = $derived(
    change.before.kind === 'absent'
      ? 'Submodule added'
      : change.after.kind === 'absent'
        ? 'Submodule removed'
        : changed
          ? 'Submodule updated'
          : 'Submodule',
  );
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4" data-diff-submodule>
  <div class="flex items-start gap-3">
    <span class="grid size-8 shrink-0 place-items-center rounded-md border bg-hover text-foreground/80">
      <FolderGit2 class="size-4" />
    </span>
    <div class="grid min-w-0 gap-1">
      <p class="text-ui font-medium">{title}</p>
      <p class="text-ui text-muted-foreground">This repository tracks a commit in a separate repository.</p>
    </div>
  </div>
  <dl class="grid gap-3 rounded-lg border p-3 text-ui">
    {#each [{ end: change.before, label: ends.before.at === 'working' ? 'Working tree' : ends.before.name }, { end: change.after, label: ends.after.at === 'working' ? 'Working tree' : ends.after.name }] as row, index (index)}
      <div class="grid min-w-0 gap-1">
        <dt class="text-small text-muted-foreground">{row.label}</dt>
        <dd
          class={[
            'min-w-0 break-all',
            row.end.kind === 'commit' && 'font-mono',
            changed && (index === 0 ? 'text-destructive' : 'text-status-done'),
          ]}
        >
          {row.end.kind === 'commit' ? row.end.oid : row.end.kind === 'file' ? 'File' : 'Not present'}
        </dd>
      </div>
    {/each}
  </dl>
  {#if change.working !== undefined}
    <div class="grid gap-1 text-ui text-muted-foreground">
      {#if change.working.state === 'uninitialized'}
        <p>The submodule is not checked out. The recorded commit is shown.</p>
      {:else if change.working.state === 'missing'}
        <p>The submodule directory is missing from the working tree.</p>
      {:else if change.after.kind === 'commit'}
        {#if !changed}<p>The recorded commit is unchanged.</p>{/if}
        {#if change.working.trackedChanges}<p>Tracked files have local changes inside the submodule.</p>{/if}
        {#if change.working.untrackedChanges}<p>Untracked files are present inside the submodule.</p>{/if}
        {#if change.working.trackedChanges || change.working.untrackedChanges}
          <p>Changes inside the submodule are not included in the parent repository’s commit.</p>
        {/if}
      {/if}
    </div>
  {/if}
</div>
