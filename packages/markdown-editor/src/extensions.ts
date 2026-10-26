import { type AnyExtension, Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { codeBlockView } from './codeBlockView.js';

const lowlight = createLowlight(common);

const primaryClicks = Extension.create({
  name: 'primaryClicks',
  addProseMirrorPlugins() {
    return [new Plugin({ props: { handleClick: (_view, _pos, event) => event.button !== 0 } })];
  },
});

export function createMarkdownEditorExtensions(options?: { placeholder?: string; extensions?: AnyExtension[] }): AnyExtension[] {
  const extensions: AnyExtension[] = [
    StarterKit.configure({
      link: false,
      codeBlock: false,
      trailingNode: false,
    }),
    CodeBlockLowlight.extend({
      addNodeView() {
        return codeBlockView;
      },
    }).configure({
      lowlight,
      defaultLanguage: null,
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: { class: 'external-link', target: '_blank', rel: 'noopener noreferrer nofollow' },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    primaryClicks,
    ...(options?.extensions ?? []),
    Markdown.configure({
      indentation: { style: 'space', size: 2 },
      markedOptions: { gfm: true },
    }),
  ];
  if (options?.placeholder !== undefined) {
    const text = options.placeholder;
    extensions.push(Placeholder.configure({ placeholder: () => text }));
  }
  return extensions;
}
