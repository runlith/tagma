import { type Editor, Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { type EditorState, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type CodeLinkOptions = {
  readonly linked: (code: string) => boolean;
};

export const CODE_LINK = 'data-code-link';

type Span = { readonly from: number; readonly to: number };

type CodeLinks = { readonly set: DecorationSet; readonly typed: Span | null };

const codeLinksKey = new PluginKey<CodeLinks>('codeLinks');

const LINKS_CHANGED = 'codeLinksChanged';

const LEFT = 'codeLinksLeft';

export function refreshCodeLinks(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta(LINKS_CHANGED, true));
}

const coded = (node: PmNode | null | undefined): node is PmNode =>
  node?.isText === true && node.marks.some((mark) => mark.type.name === 'code');

function codeAt(state: EditorState): Span | null {
  const { $head } = state.selection;
  const before = $head.nodeBefore;
  const after = $head.nodeAfter;
  if (coded(before)) return { from: $head.pos - before.nodeSize, to: $head.pos + (coded(after) ? after.nodeSize : 0) };
  return coded(after) ? { from: $head.pos, to: $head.pos + after.nodeSize } : null;
}

const same = (one: Span | null, two: Span | null): boolean => one?.from === two?.from && one?.to === two?.to;

function changedIn(tr: Transaction): Span[] {
  const spans: Span[] = [];
  tr.mapping.maps.forEach((map, index) => {
    const after = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, start, end) => spans.push({ from: after.map(start, -1), to: after.map(end, 1) }));
  });
  return spans;
}

export function createCodeLinkExtension(options: CodeLinkOptions) {
  const decorate = (doc: PmNode, span: Span, typed: Span | null): Decoration[] => {
    const found: Decoration[] = [];
    doc.nodesBetween(Math.max(0, span.from - 1), Math.min(doc.content.size, span.to + 1), (node, pos) => {
      if (!coded(node) || node.text === undefined) return;
      if (typed !== null && pos < typed.to && pos + node.nodeSize > typed.from) return;
      if (options.linked(node.text)) found.push(Decoration.inline(pos, pos + node.nodeSize, { [CODE_LINK]: node.text }));
    });
    return found;
  };

  const build = (doc: PmNode, typed: Span | null): DecorationSet =>
    DecorationSet.create(doc, decorate(doc, { from: 0, to: doc.content.size }, typed));

  const redo = (set: DecorationSet, doc: PmNode, spans: readonly Span[], typed: Span | null): DecorationSet => {
    let next = set;
    for (const span of spans) {
      const from = Math.max(0, span.from - 1);
      const to = Math.min(doc.content.size, span.to + 1);
      next = next.remove(next.find(from, to)).add(doc, decorate(doc, span, typed));
    }
    return next;
  };

  const apply = (tr: Transaction, old: CodeLinks, state: EditorState): CodeLinks => {
    if (tr.getMeta(LINKS_CHANGED) === true) return { set: build(tr.doc, old.typed), typed: old.typed };
    if (tr.docChanged) {
      const typed = codeAt(state);
      const was = old.typed === null ? [] : [{ from: tr.mapping.map(old.typed.from, -1), to: tr.mapping.map(old.typed.to, 1) }];
      return { set: redo(old.set.map(tr.mapping, tr.doc), tr.doc, [...changedIn(tr), ...was], typed), typed };
    }
    if (old.typed === null || (tr.getMeta(LEFT) !== true && same(codeAt(state), old.typed))) return old;
    return { set: redo(old.set, tr.doc, [old.typed], null), typed: null };
  };

  return Extension.create({
    name: 'codeLinks',
    addProseMirrorPlugins() {
      return [
        new Plugin<CodeLinks>({
          key: codeLinksKey,
          state: {
            init: (_, state) => ({ set: build(state.doc, null), typed: null }),
            apply: (tr, old, _before, state) => apply(tr, old, state),
          },
          props: {
            decorations: (state) => codeLinksKey.getState(state)?.set,
            handleDOMEvents: {
              blur: (view) => {
                if (codeLinksKey.getState(view.state)?.typed != null) view.dispatch(view.state.tr.setMeta(LEFT, true));
                return false;
              },
            },
          },
        }),
      ];
    },
  });
}
