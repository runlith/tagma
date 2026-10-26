import { readRef, threadRefView } from '$lib/features/graph/references.js';
import type { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import type { AnyExtension } from '@tiptap/core';
import type { Router } from '@runlith/layer/Router';
import { createBracketRefExtension } from '@runlith/markdown-editor/bracketRef';
import { currentProject } from '$lib/features/workspace/address.js';
import type { Addresses } from '$lib/features/workspace/Addresses.js';
import { type BlockRefPeer, blockRefView } from '$lib/features/graph/blockRefView.js';
import type { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
import type { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';

export const BRACKET_TARGET = 'data-bracket-ref-target';

export function bodyEditorExtensions(
  store: TreeScreen,
  titles: BlockTitles,
  router: Router,
  addresses: Addresses,
  threads: ThreadNames,
): AnyExtension[] {
  const peerOf = (target: string): BlockRefPeer => {
    const held = store.block(target)?.title;
    return held === undefined ? titles.peer(target) : { title: held, project: currentProject(router) };
  };
  return [
    createBracketRefExtension({
      parseRef: (body) => {
        const ref = readRef(`[[${body}]]`);
        if (ref === undefined || ref.kind === 'project' || ref.raw.length !== body.length + 4) return null;
        return { target: ref.target, label: ref.label ?? null };
      },
      refView: (target, label) => {
        if (readRef(`[[${target}]]`)?.kind === 'thread') return threadRefView(addresses, target, label, threads.of(target));
        const view = blockRefView(addresses, target, label, peerOf(target));
        return { text: view.text, dead: view.dead, title: view.dead ? (view.title ?? undefined) : undefined };
      },
    }),
  ];
}
