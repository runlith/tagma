import { type AnyExtension, Editor } from '@tiptap/core';

export function createHeadlessMarkdownEditor(extensions: AnyExtension[], markdown = ''): Editor {
  return new Editor({
    extensions,
    content: markdown,
    contentType: 'markdown',
    editable: false,
  });
}

export function roundTripMarkdown(extensions: AnyExtension[], markdown: string): string | null {
  try {
    const editor = createHeadlessMarkdownEditor(extensions, markdown);
    try {
      return editor.getMarkdown();
    } finally {
      editor.destroy();
    }
  } catch {
    return null;
  }
}
