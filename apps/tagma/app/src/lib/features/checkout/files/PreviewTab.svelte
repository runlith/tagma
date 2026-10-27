<script lang="ts">
  import FilePen from '@lucide/svelte/icons/file-pen';
  import { untrack } from 'svelte';
  import { pictureAddress } from '$lib/features/checkout/Repo.js';
  import { diskAddress } from './disk.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Door } from '$lib/wire/Door.js';
  import { Documents } from './Documents.svelte.js';
  import { MarkdownPreview } from './MarkdownPreview.js';
  import type { OpenedDocument } from './OpenedDocument.svelte.js';
  import { isSvg, type Tab } from './tab.js';
  import TabHead from './TabHead.svelte';

  let {
    tab,
    projectId,
    onSource,
    onBack,
    onClose,
  }: {
    tab: Tab;
    projectId: number;
    onSource: () => void;
    onBack?: (() => void) | undefined;
    onClose?: (() => void) | undefined;
  } = $props();

  const documents = Documents.use();
  const server = Door.use();
  const { Markdown } = MarkdownPreview.use();

  let opened = $state.raw<OpenedDocument | null>(null);

  const place = $derived(`${projectId}\u0000${tab.rootId}\u0000${tab.path}`);

  $effect(() => {
    void place;
    const path = untrack(() => tab.path);
    const rootId = untrack(() => tab.rootId);
    const held = untrack(() => documents.hold({ projectId, rootId }, path));
    opened = held.document;
    return () => {
      held.release();
      if (opened === held.document) opened = null;
    };
  });

  let text = $state('');
  let stamp = $state(0);
  let frame = 0;

  $effect(() => {
    const source = opened;
    void source?.revision;
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      text = untrack(() => source?.text() ?? '');
      stamp = untrack(() => source?.revision ?? 0);
    });
  });

  $effect(() => () => cancelAnimationFrame(frame));

  const body = $derived(opened?.body ?? { kind: 'loading' as const });
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-background" aria-label="Preview of {tab.path}" data-preview-tab={tab.path}>
  <TabHead path={tab.path} branch={tab.branch} {onBack} {onClose}>
    <Tooltip text="Open the source">
      <button
        type="button"
        class="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        aria-label="Open the source"
        onclick={onSource}
      >
        <FilePen class="size-3.5" />
      </button>
    </Tooltip>
  </TabHead>
  <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
    {#if body.kind === 'text'}
      {#if isSvg(tab.path)}
        <img
          src="{tab.rootId === null
            ? diskAddress(server, tab.path)
            : pictureAddress(server, projectId, tab.rootId, tab.path, 'working')}&v={stamp}"
          alt={tab.path}
          class="mx-auto max-h-full max-w-full object-contain"
          data-preview-picture
        />
      {:else}
        <Markdown {text} cacheKey="preview:{projectId}:{tab.rootId}:{tab.path}" class="mx-auto max-w-3xl" />
      {/if}
    {:else if body.kind === 'loading'}
      <p class="text-ui text-muted-foreground" aria-busy="true">Loading…</p>
    {:else}
      <p class="text-ui text-muted-foreground" data-preview-state={body.kind}>This file cannot be previewed.</p>
    {/if}
  </div>
</section>
