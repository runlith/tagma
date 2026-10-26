<script lang="ts">
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import type { ComparedPath } from '@tagma/server/workspace/contract/wire/checkout';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import CommitFiles from './CommitFiles.svelte';
  import DiffTab from './DiffTab.svelte';
  import { fileLink } from './links.js';
  import { CheckoutRepo } from './Repo.js';
  import { Checkout } from './Selection.svelte.js';

  let { projectId, sha }: { projectId: number; sha: string } = $props();

  const checkout = Checkout.use();
  const repo = CheckoutRepo.use();
  const opening = Opening.use();

  const rootId = $derived(checkout.row?.rootId ?? null);

  let opened = $state<{ readonly path: string; readonly commit: string } | null>(null);

  const reading = $derived(
    rootId === null || opened === null ? null : (repo.commitReading.key({ projectId, rootId, commit: opened.commit }).data ?? null),
  );
  const lines = $derived(opened === null ? null : (reading?.files.find((file) => file.path === opened?.path)?.lines ?? null));

  function show(file: ComparedPath): void {
    opened = { path: file.path, commit: sha };
  }
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col bg-background" data-commit-pane={sha}>
  {#if rootId === null}
    <div class="grid flex-1 place-items-center">
      <Waiting class="size-4 text-muted-foreground" label="Reading the commit" />
    </div>
  {:else if opened !== null}
    {@const file = opened}
    <DiffTab
      {projectId}
      {rootId}
      path={file.path}
      commit={file.commit}
      {lines}
      onBack={() => (opened = null)}
      closable={false}
      onClose={() => (opened = null)}
      onCommit={(commit) => (opened = { path: file.path, commit: commit ?? sha })}
      onOpenFile={(line) => void opening.open(fileLink({ path: file.path, line, root: rootId }, { project: projectId }), 'beside')}
    />
  {:else}
    <div class="min-h-0 flex-1 overflow-y-auto py-1">
      <CommitFiles {projectId} {rootId} commit={sha} grouped={false} selected={null} onOpen={show} />
    </div>
  {/if}
</div>
