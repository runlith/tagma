<script lang="ts">
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import FileTab from './files/FileTab.svelte';
  import ImageTab from './files/ImageTab.svelte';
  import PreviewTab from './files/PreviewTab.svelte';
  import type { Seen } from '@runlith/code-editor/marks';
  import { kindFor, type Tab } from './files/tab.js';
  import { fileTargetOf } from './paneContent.js';

  let { pane }: { pane: SidePane; close: () => void } = $props();

  const panes = SidePanes.use();
  const graphAim = GraphRung.Source.use();
  const aimed = $derived(graphAim() ?? null);
  const graphKey = $derived(aimed === null ? null : GraphRung.keyOf(aimed));

  const target = $derived(fileTargetOf(pane.id));
  const projectId = $derived(target?.projectId ?? aimed?.projectId ?? null);
  const picture = $derived(target !== null && kindFor(target.path, target.at !== null) === 'preview');
  let preview = $state(false);
  let view = $state.raw<Seen | null>(null);
  let seenAt = $state<string | null>(null);

  $effect(() => {
    void target;
    void graphKey;
    void panes.opened(pane.key);
    preview = picture;
    view = null;
    seenAt = null;
  });

  const tab = $derived.by<Tab | null>(() => {
    void panes.opened(pane.key);
    if (target === null) return null;
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

{#if tab !== null && projectId !== null && graphKey !== null}
  {#key graphKey}
    {#each [tab] as file (file.id)}
      {#if file.kind === 'image'}
        <ImageTab tab={file} {projectId} />
      {:else if preview}
        <PreviewTab
          tab={file}
          {projectId}
          onSource={() => {
            preview = false;
          }}
        />
      {:else}
        <FileTab
          tab={file}
          {projectId}
          staged
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
  {/key}
{/if}
