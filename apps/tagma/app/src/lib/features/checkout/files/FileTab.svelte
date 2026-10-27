<script lang="ts">
  import Eye from '@lucide/svelte/icons/eye';
  import { Host } from '@runlith/layer/Host';
  import { FileOpener } from './FileOpener.svelte.js';
  import OpenIn from './OpenIn.svelte';
  import { Outside, type OutsideFile } from './Outside.svelte.js';
  import FileQuestion from '@lucide/svelte/icons/file-question-mark';
  import FileX from '@lucide/svelte/icons/file-x';
  import TextWrap from '@lucide/svelte/icons/text-wrap';
  import Editor from '@runlith/code-editor/Editor.svelte';
  import type { Position, Seen } from '@runlith/code-editor/marks';
  import { displayLanguage } from '@runlith/utils/codeLanguage';
  import { onDestroy, untrack } from 'svelte';
  import ReadingFailed from '$lib/shared/ReadingFailed.svelte';
  import CodeFind from '../CodeFind.svelte';
  import Button from '$lib/shared/ui/button/button.svelte';
  import { formatBytes } from '$lib/shared/figures.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
  import { cn } from '$lib/shared/utils.js';
  import { Documents } from './Documents.svelte.js';
  import FileNotices from './FileNotices.svelte';
  import type { OpenedDocument } from './OpenedDocument.svelte.js';
  import { isPreviewable, type Tab } from './tab.js';
  import TabHead from './TabHead.svelte';
  import { Tabs } from './Tabs.svelte.js';

  let {
    tab,
    projectId,
    headed = true,
    onSeen,
    onPreview,
    onBack,
    onClose,
    onEdit,
    staged = false,
  }: {
    tab: Tab;
    projectId: number;
    headed?: boolean;
    staged?: boolean;
    onSeen?: ((view: Seen) => void) | undefined;
    onPreview?: (() => void) | undefined;
    onBack?: (() => void) | undefined;
    onClose?: (() => void) | undefined;
    onEdit?: (() => void) | undefined;
  } = $props();

  const documents = Documents.use();
  const marks = ReaderMarks.use();
  const tabs = Tabs.use();
  const opener = FileOpener.use();
  const outside = Outside.use();
  const apple = Host.use().apple;
  const keymap = Keymap.use();

  let editor = $state<Editor>();

  const focusLine = (): number | null => editor?.focusLine() ?? (tab.goto === null ? null : tab.goto.line + 1);

  const outsideFile = $derived<OutsideFile>({ projectId, rootId: tab.rootId, path: tab.path, line: null });

  const held = outside.hold(() => ({ ...outsideFile, line: focusLine() }));
  onDestroy(held.release);

  function show(): void {
    void opener.open({ path: tab.path, line: focusLine() }, { project: projectId, root: tab.rootId ?? undefined, reveal: true });
  }

  let opened = $state.raw<OpenedDocument | null>(null);

  const place = $derived(`${projectId}\u0000${tab.rootId}\u0000${tab.path}`);

  $effect(() => {
    void place;
    const path = untrack(() => tab.path);
    const rootId = untrack(() => tab.rootId);
    const held = untrack(() => documents.hold({ projectId, rootId }, path));
    opened = held.document;
    return () => {
      void held.document.leave('focus');
      held.release();
      if (opened === held.document) opened = null;
    };
  });

  const WRAP = 'file';
  const wrap = $derived(marks.wraps.get(WRAP) === true);
  const body = $derived(opened?.body ?? { kind: 'loading' as const });
  const at = $derived<Position | null>(tab.goto ?? tab.view);
  const conflicts = $derived(opened?.saving.kind === 'conflict' ? opened.saving.ranges : []);

  $effect(() => {
    if ((opened?.edits ?? 0) > 0) untrack(() => onEdit?.());
  });

  function compare(): void {
    tabs.open({ rootId: tab.rootId, branch: tab.branch, path: tab.path, kind: 'compare' }, 'open');
  }

  function leave(event: FocusEvent): void {
    if (event.currentTarget instanceof Node && event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
      return;
    void opened?.leave('focus');
  }

  function flip(): void {
    marks.wraps.set(WRAP, !wrap);
  }

  function keys(event: KeyboardEvent): void {
    if (event.altKey && event.code === 'KeyZ' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      flip();
    }
  }

  function near(event: KeyboardEvent): void {
    if (!(apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return;
    const act =
      event.altKey && !event.shiftKey && event.code === 'KeyO' && outside.chosen !== null
        ? () => void outside.open({ ...outsideFile, line: focusLine() })
        : event.altKey && !event.shiftKey && event.code === 'KeyC'
          ? () => void navigator.clipboard.writeText(tab.path)
          : event.shiftKey && !event.altKey && event.code === 'KeyV' && isPreviewable(tab.path) && onPreview !== undefined
            ? onPreview
            : staged && event.shiftKey && !event.altKey && event.code === 'KeyE'
              ? show
              : null;
    if (act === null) return;
    event.preventDefault();
    act();
  }

  const ICON =
    'grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground';
</script>

{#snippet notice(Icon: typeof FileX, title: string, detail: string, kind: string)}
  <div class="flex items-start gap-3 p-4" data-file-state={kind}>
    <span class="grid size-8 shrink-0 place-items-center rounded-md border bg-hover text-foreground/80">
      <Icon class="size-4" />
    </span>
    <div class="grid min-w-0 gap-0.5">
      <p class="text-ui font-medium text-foreground">{title}</p>
      <p class="text-ui break-words text-foreground/75">{detail}</p>
    </div>
  </div>
{/snippet}

<svelte:window onkeydown={keys} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="flex h-full min-h-0 min-w-0 flex-col bg-background"
  aria-label={tab.path}
  data-file-tab={tab.path}
  onkeydown={near}
  onfocusin={held.front}
>
  {#if headed}
    <TabHead path={tab.path} branch={tab.branch} onShow={staged ? show : undefined} {onBack} {onClose}>
      {#if body.kind === 'text' && body.readOnly === 'undecodable'}
        <span class="mr-1 shrink-0 rounded-sm bg-hover px-1.5 py-0.5 text-meta text-muted-foreground" data-file-readonly
          >Read only · not UTF-8</span
        >
      {/if}
      {#if onPreview !== undefined && isPreviewable(tab.path)}
        <Tooltip text="Open preview" keys={keymap.spell(keymap.mod('KeyV', { shift: true }))}>
          <button type="button" class={ICON} aria-label="Open preview" onclick={onPreview}>
            <Eye class="size-3.5" />
          </button>
        </Tooltip>
      {/if}
      <OpenIn file={outsideFile} line={focusLine} />
      <Tooltip text="Wrap lines" keys={keymap.spell({ ...keymap.bare('KeyZ'), alt: true })}>
        <button
          type="button"
          class={cn(ICON, wrap && 'bg-selected text-foreground')}
          aria-label="Wrap lines"
          aria-pressed={wrap}
          onclick={flip}
        >
          <TextWrap class="size-3.5" />
        </button>
      </Tooltip>
    </TabHead>
  {/if}
  {#if body.kind === 'text' && opened?.document}
    <FileNotices {opened} onCompare={projectId === tabs.projectId ? compare : undefined} />
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="min-h-0 flex-1" data-file-editor onfocusout={leave}>
      {#key opened.document}
        <Editor
          bind:this={editor}
          document={opened.document}
          language={displayLanguage(tab.path)}
          readOnly={body.readOnly !== null}
          {conflicts}
          {wrap}
          {at}
          onView={onSeen}
        >
          {#snippet find(control)}<CodeFind find={control} />{/snippet}
        </Editor>
      {/key}
    </div>
  {:else if body.kind === 'loading'}
    <div class="grid gap-2 p-4" aria-busy="true" data-file-loading>
      {#each [72, 58, 84, 46, 66] as width, index (index)}
        <span class="block h-2 animate-pulse rounded-sm bg-selected" style:width="{width}%"></span>
      {/each}
    </div>
  {:else if body.kind === 'binary'}
    {@render notice(
      FileQuestion,
      'Binary file',
      `${tab.path} holds bytes this pane does not draw as text · ${formatBytes(body.size)}.`,
      'binary',
    )}
  {:else if body.kind === 'tooLarge'}
    {@render notice(
      FileQuestion,
      'File too large',
      `${tab.path} is ${formatBytes(body.size)}, past what this pane reads as text.`,
      'too-large',
    )}
    <div class="px-4">
      <Button size="sm" variant="outline" onclick={() => void navigator.clipboard.writeText(tab.path)} data-file-copy-path>Copy path</Button
      >
    </div>
  {:else if body.kind === 'gone'}
    {@render notice(FileX, 'File gone', `${tab.path} no longer exists${tab.rootId === null ? '' : ' in this checkout'}.`, 'gone')}
  {:else if body.kind === 'unreadable'}
    <div class="p-4" data-file-state="unreadable">
      <ReadingFailed failure={new Error(body.reason)} title="This file could not be read" onRetry={() => opened?.retry()} />
    </div>
  {/if}
</section>
