import { type Editor, Node } from '@tiptap/core';
import { type EditorState, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type BracketRef = { target: string; label: string | null };

export type BracketRefView = {
  text: string;
  dead: boolean;
  title?: string;
};

export type BracketRefOptions = {
  parseRef(body: string): BracketRef | null;
  refView(target: string, label: string | null): BracketRefView;
  onOpen?(target: string): Promise<void> | void;
};

const BRACKET_REF_SCAN = /\[\[([^[\]\r\n]+)\]\]/g;
const BRACKET_REF_INLINE = /^\[\[([^[\]\r\n]+)\]\]/;
const BRACKET_OPEN = '[[';

const dissolveKey = new PluginKey('bracketRefDissolve');
const autoConvertKey = new PluginKey('bracketRefAutoConvert');
const previewKey = new PluginKey('bracketRefPreview');
const refreshKey = new PluginKey<number>('bracketRefViews');

type BracketRefStorage = { views: Set<() => void> };

const REFS_CHANGED = 'bracketRefsChanged';

export function refreshBracketRefs(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta(REFS_CHANGED, true));
}

export function formatBracketRef(target: string, label: string | null): string {
  return label ? `[[${target}|${label}]]` : `[[${target}]]`;
}

type TextNodeLike = { type: { name: string }; text?: string; marks: readonly { type: { name: string } }[] };
type ParentLike = { type: { spec: { code?: boolean } } } | null;

function canHoldRef(node: TextNodeLike, parent: ParentLike): node is TextNodeLike & { text: string } {
  return (
    node.type.name === 'text' &&
    !!node.text &&
    node.text.includes(BRACKET_OPEN) &&
    parent?.type.spec.code !== true &&
    !node.marks.some((mark) => mark.type.name === 'code')
  );
}

function refOf(node: { attrs: Record<string, unknown> }): BracketRef {
  return {
    target: typeof node.attrs.target === 'string' ? node.attrs.target : '',
    label: typeof node.attrs.label === 'string' && node.attrs.label ? node.attrs.label : null,
  };
}

export function createBracketRefExtension(options: BracketRefOptions) {
  const buildPreviewDecorations = (state: EditorState): DecorationSet => {
    const decorations: Decoration[] = [];
    const cursor = state.selection.from;
    state.doc.descendants((node, pos, parent) => {
      if (!canHoldRef(node as TextNodeLike, parent as ParentLike)) {
        return;
      }
      for (const match of (node.text as string).matchAll(BRACKET_REF_SCAN)) {
        const ref = options.parseRef(match[1]!);
        if (!ref || match.index === undefined) {
          continue;
        }
        const from = pos + match.index;
        const to = from + match[0].length;
        if (cursor <= from || cursor > to) {
          continue;
        }
        const cls = options.refView(ref.target, ref.label).dead ? 'bracket-ref-preview bracket-ref-preview--dead' : 'bracket-ref-preview';
        decorations.push(Decoration.inline(from, to, { class: cls }));
      }
    });
    return DecorationSet.create(state.doc, decorations);
  };

  return Node.create<BracketRefOptions, BracketRefStorage>({
    name: 'bracketRef',
    addStorage: () => ({ views: new Set() }),
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,

    addAttributes() {
      return {
        target: {
          default: '',
          parseHTML: (el: HTMLElement) => el.getAttribute('data-bracket-ref-target') ?? '',
        },
        label: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-bracket-ref-label'),
        },
      };
    },

    markdownTokenName: 'bracketRef',
    markdownTokenizer: {
      name: 'bracketRef',
      level: 'inline',
      start: (src: string) => {
        const index = src.indexOf(BRACKET_OPEN);
        return index < 0 ? -1 : index;
      },
      tokenize(src: string) {
        const match = BRACKET_REF_INLINE.exec(src);
        if (!match) {
          return undefined;
        }
        const ref = options.parseRef(match[1]!);
        if (!ref) {
          return undefined;
        }
        return {
          type: 'bracketRef',
          raw: match[0],
          text: ref.target,
          label: ref.label ?? undefined,
        };
      },
    },

    parseMarkdown: (token, helpers) => {
      if (token.type !== 'bracketRef') {
        return [];
      }
      return helpers.createNode('bracketRef', {
        target: typeof token.text === 'string' ? token.text : '',
        label: typeof (token as { label?: unknown }).label === 'string' ? (token as { label: string }).label : null,
      });
    },

    renderMarkdown: (node) => {
      const ref = refOf(node as { attrs: Record<string, unknown> });
      return formatBracketRef(ref.target, ref.label);
    },
    renderText: ({ node }) => {
      const ref = refOf(node);
      return ref.label ?? ref.target;
    },

    addNodeView() {
      const views = this.storage.views;
      return ({ node }: { node: { type: { name: string }; attrs: Record<string, unknown> } }) => {
        const dom = document.createElement('span');
        dom.setAttribute('contenteditable', 'false');

        const render = (current: { attrs: Record<string, unknown> }): void => {
          const ref = refOf(current);
          const view = options.refView(ref.target, ref.label);
          dom.setAttribute('data-bracket-ref-target', ref.target);
          if (ref.label) {
            dom.setAttribute('data-bracket-ref-label', ref.label);
          } else {
            dom.removeAttribute('data-bracket-ref-label');
          }
          dom.className = view.dead ? 'bracket-ref bracket-ref--dead' : 'bracket-ref';
          dom.textContent = view.text;
          if (view.title !== undefined) {
            dom.setAttribute('title', view.title);
          } else {
            dom.removeAttribute('title');
          }
        };

        const refresh = (): void => render(node);
        views.add(refresh);
        refresh();

        const open = (event: MouseEvent): void => {
          event.preventDefault();
          const opening = options.onOpen?.(refOf(node).target);
          if (opening === undefined) return;
          dom.setAttribute('aria-busy', 'true');
          void opening.finally(() => dom.removeAttribute('aria-busy'));
        };
        dom.addEventListener('click', open);

        return {
          dom,
          update: (updatedNode: { type: { name: string }; attrs: Record<string, unknown> }) => {
            if (updatedNode.type.name !== 'bracketRef') {
              return false;
            }
            node = updatedNode;
            refresh();
            return true;
          },
          destroy: () => {
            views.delete(refresh);
            dom.removeEventListener('click', open);
          },
        };
      };
    },

    addProseMirrorPlugins() {
      const nodeType = this.type;
      const views = this.storage.views;
      return [
        new Plugin({
          key: refreshKey,
          state: {
            init: () => 0,
            apply: (tr, revision) => (tr.getMeta(REFS_CHANGED) ? revision + 1 : revision),
          },
          view: () => ({
            update: (view, previous) => {
              if (refreshKey.getState(view.state) === refreshKey.getState(previous)) return;
              for (const refresh of views) refresh();
            },
          }),
        }),
        new Plugin({
          key: dissolveKey,
          props: {
            handleKeyDown(view, event) {
              if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
                return false;
              }
              let direction: 'left' | 'right';
              if (event.key === 'ArrowLeft') {
                direction = 'left';
              } else if (event.key === 'ArrowRight') {
                direction = 'right';
              } else {
                return false;
              }
              const { state } = view;
              if (!(state.selection instanceof TextSelection)) {
                return false;
              }
              const { $from } = state.selection;
              const adjacent = direction === 'left' ? $from.nodeBefore : $from.nodeAfter;
              if (!adjacent || adjacent.type.name !== 'bracketRef') {
                return false;
              }
              const ref = refOf(adjacent);
              const text = formatBracketRef(ref.target, ref.label);
              const nodeStart = direction === 'left' ? $from.pos - adjacent.nodeSize : $from.pos;
              const nodeEnd = nodeStart + adjacent.nodeSize;
              const tr = state.tr.replaceWith(nodeStart, nodeEnd, state.schema.text(text));
              const cursorPos = direction === 'left' ? nodeStart + text.length - 2 : nodeStart + 2;
              tr.setSelection(TextSelection.create(tr.doc, cursorPos));
              view.dispatch(tr);
              return true;
            },
          },
        }),

        new Plugin({
          key: autoConvertKey,
          appendTransaction(_transactions, _oldState, newState) {
            const { tr } = newState;
            const cursor = newState.selection.from;
            let modified = false;

            newState.doc.descendants((node, pos, parent) => {
              if (!canHoldRef(node as TextNodeLike, parent as ParentLike)) {
                return;
              }
              for (const match of (node.text as string).matchAll(BRACKET_REF_SCAN)) {
                const ref = options.parseRef(match[1]!);
                if (!ref || match.index === undefined) {
                  continue;
                }
                const from = pos + match.index;
                const to = from + match[0].length;
                if (cursor > from && cursor <= to) {
                  continue;
                }
                const refNode = nodeType.create({ target: ref.target, label: ref.label });
                tr.replaceWith(tr.mapping.map(from), tr.mapping.map(to), refNode);
                modified = true;
              }
            });

            return modified ? tr : null;
          },
        }),

        new Plugin({
          key: previewKey,
          state: {
            init(_config, state) {
              return buildPreviewDecorations(state);
            },
            apply(tr, previous, oldState, newState) {
              const selectionMoved = !oldState.selection.eq(newState.selection);
              if (!tr.docChanged && !selectionMoved && !tr.getMeta(REFS_CHANGED)) {
                return previous;
              }
              return buildPreviewDecorations(newState);
            },
          },
          props: {
            decorations(state) {
              return previewKey.getState(state);
            },
          },
        }),
      ];
    },

    parseHTML() {
      return [{ tag: 'span[data-bracket-ref-target]' }];
    },

    renderHTML({ node, HTMLAttributes }) {
      const ref = refOf(node);
      const view = options.refView(ref.target, ref.label);
      return ['span', { ...HTMLAttributes, class: view.dead ? 'bracket-ref bracket-ref--dead' : 'bracket-ref' }, view.text];
    },
  });
}
