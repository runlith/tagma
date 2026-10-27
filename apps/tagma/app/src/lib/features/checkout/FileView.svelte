<script lang="ts">
  import type { Seen } from '@runlith/code-editor/marks';
  import FileTab from './files/FileTab.svelte';
  import ImageTab from './files/ImageTab.svelte';
  import PreviewTab from './files/PreviewTab.svelte';
  import { kindFor, type Tab } from './files/tab.js';
  import type { FileTarget } from './paneContent.js';

  let {
    target,
    projectId,
    opened = 0,
    onBack,
    onClose,
  }: {
    target: FileTarget;
    projectId: number;
    opened?: number;
    onBack?: (() => void) | undefined;
    onClose?: (() => void) | undefined;
  } = $props();

  const picture = $derived(kindFor(target.path, target.at !== null) === 'preview');
  let preview = $state(false);
  let view = $state.raw<Seen | null>(null);
  let seenAt = $state<string | null>(null);

  $effect(() => {
    void target;
    void projectId;
    void opened;
    preview = picture;
    view = null;
    seenAt = null;
  });

  const tab = $derived.by<Tab>(() => {
    void opened;
    const id = `${projectId}\u0000${target.rootId}\u0000${target.path}`;
    const saved = seenAt === id ? view : null;
    return {
      id,
      rootId: target.rootId,
      branch: null,
      path: target.path,
      kind: kindFor(target.path, true),
      diff: null,
      state: 'open',
      view: saved,
      goto:
        saved !== null || target.at === null
          ? null
          : { line: Math.max(target.at.line - 1, 0), column: Math.max((target.at.column ?? 1) - 1, 0) },
    };
  });
</script>

{#each [tab] as file (file.id)}
  {#if file.kind === 'image'}
    <ImageTab tab={file} {projectId} {onBack} {onClose} />
  {:else if preview}
    <PreviewTab
      tab={file}
      {projectId}
      {onBack}
      {onClose}
      onSource={() => {
        preview = false;
      }}
    />
  {:else}
    <FileTab
      tab={file}
      {projectId}
      staged
      {onBack}
      {onClose}
      onPreview={() => {
        preview = true;
      }}
      onSeen={(seen) => {
        seenAt = file.id;
        view = seen;
      }}
    />
  {/if}
{/each}
