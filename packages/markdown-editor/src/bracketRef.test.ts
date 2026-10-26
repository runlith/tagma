import { describe, expect, test } from 'vitest';
import { createHeadlessMarkdownEditor, roundTripMarkdown } from './codec.js';
import { createBracketRefExtension } from './bracketRef.js';
import { createMarkdownEditorExtensions } from './extensions.js';

const refExtension = createBracketRefExtension({
  parseRef: (body) => {
    const match = /^L-(\d+)(?:\|(.+))?$/.exec(body);
    if (!match) return null;
    return { target: `L-${match[1]}`, label: match[2] ?? null };
  },
  refView: (target, label) => ({ text: label ?? `Title of ${target}`, dead: target === 'L-404' }),
});

const schema = () => createMarkdownEditorExtensions({ extensions: [refExtension] });

describe('bracketRef', () => {
  type LooseNode = { type?: string; attrs?: Record<string, unknown>; text?: string; content?: LooseNode[] };

  test('a recognized reference parses to an atom and serializes back verbatim', () => {
    const source = 'See [[L-89]] and [[L-17|the picker]] for details.\n';
    const editor = createHeadlessMarkdownEditor(schema(), source);
    try {
      const doc = editor.getJSON() as LooseNode;
      const paragraph = doc.content?.[0];
      const refs = (paragraph?.content ?? []).filter((node) => node.type === 'bracketRef');
      expect(refs.map((node) => node.attrs)).toEqual([
        { target: 'L-89', label: null },
        { target: 'L-17', label: 'the picker' },
      ]);
      expect(editor.getMarkdown()).toBe('See [[L-89]] and [[L-17|the picker]] for details.');
    } finally {
      editor.destroy();
    }
  });

  test('a rejected bracket body stays plain text, never an atom', () => {
    const editor = createHeadlessMarkdownEditor(schema(), 'Not a ref: [[just words]].\n');
    try {
      const doc = editor.getJSON() as LooseNode;
      const paragraph = doc.content?.[0];
      const refs = (paragraph?.content ?? []).filter((node) => node.type === 'bracketRef');
      expect(refs).toEqual([]);
    } finally {
      editor.destroy();
    }
  });

  test('references inside code stay literal', () => {
    const source = '```\n[[L-89]]\n```\n';
    const editor = createHeadlessMarkdownEditor(schema(), source);
    try {
      const doc = editor.getJSON() as LooseNode;
      expect(doc.content?.[0]?.type).toBe('codeBlock');
      expect(doc.content?.[0]?.content?.[0]?.text).toBe('[[L-89]]');
    } finally {
      editor.destroy();
    }
  });

  test('the everyday shapes round-trip through the schema', () => {
    const source = '# Heading\n\n- one\n- two\n\n```ts\nconst a = 1;\n```\n';
    const output = roundTripMarkdown(schema(), source);
    expect(output).toContain('# Heading');
    expect(output).toContain('- one');
    expect(output).toContain('```ts');
  });
});
