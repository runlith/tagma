<script lang="ts">
  import { type AnyExtension, Editor } from '@tiptap/core';
  import { untrack } from 'svelte';
  import { roundTripMarkdown } from './codec.js';
  import { createMarkdownEditorExtensions } from './extensions.js';
  import { reconcileMarkdown } from './reconcile.js';

  let {
    markdown = '',
    placeholder,
    extensions = [],
    class: contentClass = '',
    onCommit,
    editor = $bindable(null),
  }: {
    markdown?: string;
    placeholder?: string;
    extensions?: AnyExtension[];
    class?: string;
    onCommit: (markdown: string) => void;
    editor?: Editor | null;
  } = $props();

  let host = $state<HTMLDivElement | null>(null);
  let schema: AnyExtension[] = [];
  let focused = $state(false);

  let originalSource = '';
  let baseCanonical = '';
  let lastCommitted = '';
  let lastSeen = '';

  function commit(): void {
    const current = editor;
    if (!current) return;
    let edited: string;
    try {
      edited = current.getMarkdown();
    } catch {
      return;
    }
    const reconciled = reconcileMarkdown({
      originalSource,
      baseCanonical,
      edited,
      roundTrip: (value) => roundTripMarkdown(schema, value),
    });
    const changed = reconciled !== originalSource;
    originalSource = reconciled;
    baseCanonical = edited;
    lastCommitted = reconciled;
    if (changed) onCommit(reconciled);
  }

  $effect(() => {
    const el = host;
    if (!el) return;

    const initial = untrack(() => markdown);
    schema = createMarkdownEditorExtensions({
      placeholder: untrack(() => placeholder),
      extensions: untrack(() => extensions),
    });
    const instance = untrack(
      () =>
        new Editor({
          element: el,
          extensions: schema,
          content: initial,
          contentType: 'markdown',
          editorProps: {
            attributes: {
              class: untrack(() => contentClass),
              spellcheck: 'false',
            },
            handleKeyDown: (_view, event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                commit();
                return true;
              }
              return false;
            },
          },
          onFocus: () => {
            queueMicrotask(() => {
              if (instance.isDestroyed) return;
              focused = instance.isFocused;
            });
          },
          onBlur: () => {
            queueMicrotask(() => {
              if (instance.isDestroyed) return;
              commit();
              focused = instance.isFocused;
            });
          },
        }),
    );
    editor = instance;
    originalSource = initial;
    baseCanonical = instance.getMarkdown();
    lastCommitted = initial;
    lastSeen = initial;

    return () => {
      commit();
      instance.destroy();
      if (editor === instance) editor = null;
    };
  });

  $effect(() => {
    const next = markdown;
    const current = editor;
    if (!current || next === lastSeen || focused) return;
    lastSeen = next;
    if (next === lastCommitted) return;
    current.commands.setContent(next, { contentType: 'markdown' });
    originalSource = next;
    baseCanonical = current.getMarkdown();
    lastCommitted = next;
  });
</script>

<div bind:this={host} class="markdown-editor-host"></div>

<style>
  .markdown-editor-host :global(.ProseMirror) {
    outline: none;
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }
  .markdown-editor-host :global(.ProseMirror p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--muted-foreground, #888);
    opacity: 0.5;
    pointer-events: none;
  }
</style>
