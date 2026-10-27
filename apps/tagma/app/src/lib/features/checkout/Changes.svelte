<script lang="ts">
  import { Seam } from '@runlith/seam/Seam.svelte';
  import SeamHandle from '@runlith/seam/SeamHandle.svelte';
  import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
  import { Seams } from '$lib/shared/seams/Seams.svelte.js';
  import ChangesList from './ChangesList.svelte';
  import DiffStage from './DiffStage.svelte';
  import FileView from './FileView.svelte';
  import { CHANGES_LAYOUT, layoutOf } from './layout.js';
  import type { FileTarget } from './paneContent.js';
  import { CHANGES_SEAM } from './seams.js';
  import { ThreadChanges } from './ThreadChanges.svelte.js';

  const changes = ThreadChanges.use();
  const seams = Seams.use();
  const marks = ReaderMarks.use();

  const seam = new Seam(seams.seam(CHANGES_SEAM), { onCommit: (size) => seams.set(CHANGES_SEAM, size) });
  const layout = $derived(layoutOf(marks.layouts.get(CHANGES_LAYOUT)));
  const split = $derived(layout === 'split');
  const file = $derived(changes.open);
  const covered = $derived(file !== null && !split);
  const disk = $derived<FileTarget | null>(file?.rootId === null ? { projectId: null, rootId: null, path: file.path, at: null } : null);

  const close = (): void => {
    changes.open = null;
  };
</script>

<div class="relative flex h-full min-h-0 min-w-0" data-changes={layout}>
  <div
    class={['min-h-0 min-w-0', split ? 'shrink-0 border-r' : 'flex-1']}
    style:width={split ? `${seam.size}px` : undefined}
    style:visibility={covered ? 'hidden' : undefined}
    inert={covered}
  >
    <ChangesList />
  </div>
  {#if split}
    <SeamHandle {seam} label="Resize the changes list" contained />
  {/if}
  {#if split || file !== null}
    <div class={split ? 'min-h-0 min-w-0 flex-1' : 'absolute inset-0 min-h-0 min-w-0'} data-changes-diff>
      {#if file !== null && disk !== null}
        <FileView target={disk} projectId={file.projectId} onBack={split ? undefined : close} onClose={split ? close : undefined} />
      {:else if file !== null && file.rootId !== null}
        <DiffStage {file} onBack={split ? undefined : close} />
      {:else if !changes.empty || changes.lens === 'base'}
        <p class="grid h-full place-items-center px-6 text-center text-ui text-muted-foreground" data-changes-pick>
          Select a file to see its diff
        </p>
      {/if}
    </div>
  {/if}
</div>
