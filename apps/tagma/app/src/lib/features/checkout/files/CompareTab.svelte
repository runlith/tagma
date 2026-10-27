<script lang="ts">
  import Diff from '@runlith/code-editor/Diff.svelte';
  import type { DiffLine } from '@runlith/code-editor/marks';
  import { displayLanguage } from '@runlith/utils/codeLanguage';
  import { untrack } from 'svelte';
  import CodeFind from '../CodeFind.svelte';
  import { compareRows } from './compareRows.js';
  import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
  import { Documents } from './Documents.svelte.js';
  import FileNotices from './FileNotices.svelte';
  import type { OpenedDocument } from './OpenedDocument.svelte.js';
  import type { Tab } from './tab.js';
  import TabHead from './TabHead.svelte';
  import { Tabs } from './Tabs.svelte.js';

  let { tab, onBack }: { tab: Tab; onBack?: (() => void) | undefined } = $props();

  const documents = Documents.use();
  const door = GraphDoor.use();
  const tabs = Tabs.use();

  let opened = $state.raw<OpenedDocument | null>(null);

  const place = $derived(`${tab.rootId}\u0000${tab.path}`);

  $effect(() => {
    void place;
    const path = untrack(() => tab.path);
    const rootId = untrack(() => tab.rootId);
    const held = untrack(() => documents.hold({ projectId: door.aim.projectId, rootId }, path));
    opened = held.document;
    return () => {
      held.release();
      if (opened === held.document) opened = null;
    };
  });

  const disk = $derived(opened?.disk ?? null);
  let rows = $state.raw<readonly DiffLine[]>([]);
  let failed = $state<string | null>(null);

  $effect(() => {
    const source = opened;
    const standing = disk;
    void source?.revision;
    const before = standing?.read() ?? null;
    if (source === null || before === null) {
      rows = [];
      return;
    }
    const after = untrack(() => source.document?.read() ?? '');
    let current = true;
    failed = null;
    documents.differ.edits(before, after, `${source.key}#compare`).then(
      (edits) => {
        if (current && edits !== null) rows = compareRows(before, edits);
      },
      (failure: unknown) => {
        if (current) failed = failure instanceof Error ? failure.message : String(failure);
      },
    );
    return () => {
      current = false;
    };
  });

  $effect(() => {
    if (opened !== null && opened.body.kind === 'text' && opened.disk === null) untrack(() => tabs.close(tab.id));
  });
</script>

<section
  class="flex h-full min-h-0 min-w-0 flex-col bg-background"
  aria-label="Disk against your buffer: {tab.path}"
  data-compare-tab={tab.path}
>
  <TabHead path={tab.path} branch={tab.branch} {onBack}>
    <span class="mr-1 shrink-0 rounded-sm bg-hover px-1.5 py-0.5 text-meta text-muted-foreground">Disk ↔ your buffer</span>
  </TabHead>
  {#if opened !== null}
    <FileNotices {opened} />
  {/if}
  {#if failed !== null}
    <p class="shrink-0 border-b bg-hover px-3 py-1.5 text-ui text-destructive" role="alert">{failed}</p>
  {/if}
  <div class="min-h-0 flex-1">
    {#key disk?.digest}
      <Diff {rows} language={displayLanguage(tab.path)}>
        {#snippet find(control)}<CodeFind find={control} />{/snippet}
      </Diff>
    {/key}
  </div>
</section>
