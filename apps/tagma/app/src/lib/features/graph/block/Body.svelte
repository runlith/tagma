<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { Router } from '@runlith/layer/Router';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import MarkdownEditor from '@runlith/markdown-editor/MarkdownEditor.svelte';
  import { refreshBracketRefs } from '@runlith/markdown-editor/bracketRef';
  import { CODE_LINK, createCodeLinkExtension, refreshCodeLinks } from '@runlith/markdown-editor/codeLinks';
  import { untrack } from 'svelte';
  import { BRACKET_TARGET, bodyEditorExtensions } from '$lib/features/graph/block/bodyEditor.js';
  import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
  import { blockLink } from '$lib/features/graph/links.js';
  import type { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { linkWithin } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { PathChecks } from '$lib/features/opening/PathChecks.js';
  import { readRef, threadRefView } from '$lib/features/graph/references.js';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import type { PathLink, PathRoad } from '$lib/features/opening/PathLinks.js';
  import { pathCodeOf } from '$lib/features/opening/pathCode.js';

  let { store, body, paths }: { store: TreeScreen; body: string; paths?: PathRoad | undefined } = $props();

  const blockTitles = BlockTitles.use();
  const threads = ThreadNames.use();
  const router = Router.use();
  const addresses = Addresses.use();
  const opening = Opening.use();
  const notices = Notices.use();
  const here = App.current();

  let editor = $state<Editor | null>(null);

  let checks: PathChecks<PathLink | null> | null = null;

  $effect(() => {
    const instance = editor;
    const made = paths === undefined ? null : new PathChecks(paths);
    checks = made;
    if (instance !== null) untrack(() => refreshCodeLinks(instance));
    return () => made?.close();
  });

  function linked(text: string): boolean {
    const code = pathCodeOf(text);
    const made = checks;
    if (code === null || made === null) return false;
    if (!made.has(code.path))
      void made.read(code.path).then(
        (link) => {
          if (link !== null && !made.closed && editor !== null) refreshCodeLinks(editor);
        },
        (error: unknown) => {
          if (!made.closed) notices.background(error);
        },
      );
    return made.known(code.path) != null;
  }

  const codeLinks = createCodeLinkExtension({ linked });

  const linkOf = (element: HTMLElement) => {
    if (element instanceof HTMLAnchorElement) return opening.anchored(element.href, here);
    const target = element.getAttribute(BRACKET_TARGET);
    if (target !== null) {
      if (readRef(`[[${target}]]`)?.kind === 'thread') return threadRefView(addresses, target, null, threads.of(target)).link;
      return element.classList.contains('bracket-ref--dead') ? null : blockLink({ name: target });
    }
    const code = pathCodeOf(element.getAttribute(CODE_LINK) ?? '');
    const link = code === null ? undefined : checks?.known(code.path);
    return code === null || link == null ? null : link(code);
  };

  let threadTargets = $state.raw<string[]>([]);

  $effect(() => {
    const instance = editor;
    if (!instance) return;
    const follow = () => {
      const targets: string[] = [];
      instance.state.doc.descendants((node) => {
        if (node.type.name === 'bracketRef' && readRef(`[[${node.attrs.target}]]`)?.kind === 'thread') targets.push(node.attrs.target);
      });
      if (targets.length !== threadTargets.length || targets.some((target, index) => target !== threadTargets[index]))
        threadTargets = targets;
    };
    untrack(follow);
    instance.on('update', follow);
    return () => {
      instance.off('update', follow);
    };
  });

  $effect(() => {
    const instance = editor;
    if (!instance) return;
    for (const block of store.blocks.values()) void block.title;
    void blockTitles.answered;
    for (const target of threadTargets) threads.of(target);
    untrack(() => refreshBracketRefs(instance));
  });

  function commit(markdown: string): void {
    if (store.rootName != null && markdown !== body) void store.setBody(store.rootName, markdown);
  }
</script>

<div class="mt-4" {@attach linkWithin(opening, `[${CODE_LINK}], [${BRACKET_TARGET}], a[href]`, linkOf, here)}>
  {#key store}
    <MarkdownEditor
      markdown={body}
      placeholder="Add notes…"
      extensions={[...bodyEditorExtensions(store, blockTitles, router, addresses, threads), codeLinks]}
      class="markdown-body min-h-6 text-body leading-6"
      onCommit={commit}
      bind:editor
    />
  {/key}
</div>
