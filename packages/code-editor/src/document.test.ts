import { EditorState } from '@codemirror/state';
import { type EditorView, runScopeHandlers } from '@codemirror/view';
import { applyLineEdits, type LineEdit } from '@runlith/files/lines';
import { Result } from 'effect';
import { afterEach, describe, expect, test } from 'vitest';
import { TextDocument } from './document';

const BASE = Array.from({ length: 10 }, (_, at) => `line ${at}\n`).join('');
const applied = (text: string, edits: readonly LineEdit[]): string => Result.getOrThrow(applyLineEdits(text, edits));

const mounted: EditorView[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) view.destroy();
});

function open(text = BASE, readOnly = false): { document: TextDocument; view: EditorView } {
  const document = new TextDocument(text, 'disk-1');
  const view = document.mount(window.document.body.appendChild(window.document.createElement('div')), EditorState.readOnly.of(readOnly));
  mounted.push(view);
  return { document, view };
}

function typeAtEndOf(view: EditorView, line: number, text: string): void {
  const at = view.state.doc.line(line + 1).to;
  view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input.type' });
}

function retype(view: EditorView, next: string): void {
  const now = view.state.doc.toString();
  let head = 0;
  while (head < Math.min(now.length, next.length) && now[head] === next[head]) head += 1;
  let tail = 0;
  while (tail < Math.min(now.length, next.length) - head && now[now.length - 1 - tail] === next[next.length - 1 - tail]) tail += 1;
  view.dispatch({ changes: { from: head, to: now.length - tail, insert: next.slice(head, next.length - tail) }, userEvent: 'input' });
}

const undoKey = (view: EditorView): boolean => runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }), 'editor');

describe('pending is what the buffer holds, as line edits of the base', () => {
  const shapes: readonly (readonly string[])[] = [
    [''],
    ['a'],
    ['a', ''],
    ['a', 'b'],
    ['a', 'b', ''],
    ['', 'a'],
    ['x\ry', 'z\r'],
    ['a', 'b', 'c', ''],
  ];
  for (const [family, eol, bom] of [
    ['LF', '\n', ''],
    ['CRLF', '\r\n', ''],
    ['LF with a byte order mark', '\n', '\uFEFF'],
  ] as const) {
    test(`any ${family} text written over any other, applied to the base, gives exactly the buffer`, () => {
      for (const from of shapes) {
        for (const to of shapes) {
          const base = bom + from.join(eol);
          const { document, view } = open(base);
          retype(view, to.join('\n'));
          const prevailing = from.length > 1 ? eol : '\n';
          expect([base, applied(base, document.pending().edits)]).toEqual([base, bom + to.join(prevailing)]);
          view.destroy();
        }
      }
    });
  }
});

describe('a foreign edit meets the operator buffer', () => {
  test('edits that miss the operator lines land around them, the cursor stays on its text, and pending rebuilds the buffer from the new base', () => {
    const { document, view } = open();
    typeAtEndOf(view, 5, ' mine');
    const theirs: LineEdit[] = [
      { from: 1, to: 1, lines: ['agent a', 'agent b'] },
      { from: 8, to: 9, lines: ['agent eight'] },
    ];

    expect(document.rebase(theirs, 'disk-2')).toEqual({ kind: 'applied' });

    const buffer = view.state.doc.toString();
    expect(buffer).toBe(applied(applied(BASE, [{ from: 5, to: 6, lines: ['line 5 mine'] }]), theirs));
    expect(view.state.selection.main.head).toBe(view.state.doc.line(8).to);
    const pending = document.pending();
    expect(pending.digest).toBe('disk-2');
    expect(applied(applied(BASE, theirs), pending.edits)).toBe(buffer);
  });

  test('an edit on the operator lines is a conflict naming them, and the buffer stays as typed', () => {
    const { document, view } = open();
    typeAtEndOf(view, 5, ' mine');
    const typed = view.state.doc.toString();

    expect(document.rebase([{ from: 4, to: 6, lines: ['agent four'] }], 'disk-2')).toEqual({
      kind: 'conflict',
      ranges: [{ from: 5, to: 6 }],
    });
    expect(view.state.doc.toString()).toBe(typed);
    expect(applied(BASE, document.pending().edits)).toBe(typed);
  });

  test('a deleted line does not clash with an edit of the line after it', () => {
    const { document, view } = open('a\nb\nc\n');
    view.dispatch({ changes: { from: 0, to: 2 }, userEvent: 'delete' });

    expect(document.rebase([{ from: 1, to: 2, lines: ['B'] }], 'disk-2')).toEqual({ kind: 'applied' });
    expect(view.state.doc.toString()).toBe('B\nc\n');
  });

  test('a dirty buffer takes a foreign edit only as a rebase, so an overlap is a conflict and not a merge', () => {
    const { document, view } = open();
    typeAtEndOf(view, 5, ' mine');
    const typed = view.state.doc.toString();

    expect(document.applyRemote([{ from: 5, to: 6, lines: ['agent five'] }], 'disk-2')).toMatchObject({ kind: 'conflict' });
    expect(view.state.doc.toString()).toBe(typed);
  });

  test('undo after a foreign edit takes back only the operator edit', () => {
    const { document, view } = open();
    typeAtEndOf(view, 2, ' mine');
    expect(document.rebase([{ from: 0, to: 1, lines: ['agent zero'] }], 'disk-2')).toEqual({ kind: 'applied' });

    undoKey(view);

    expect(view.state.doc.toString()).toBe(applied(BASE, [{ from: 0, to: 1, lines: ['agent zero'] }]));
    expect(document.dirty).toBe(false);
  });

  test('a read-only view does not undo the shared history', () => {
    const document = new TextDocument(BASE, 'disk-1');
    const writer = document.mount(window.document.body.appendChild(window.document.createElement('div')), []);
    const reader = document.mount(window.document.body.appendChild(window.document.createElement('div')), EditorState.readOnly.of(true));
    mounted.push(writer, reader);
    typeAtEndOf(writer, 2, ' mine');
    const typed = writer.state.doc.toString();

    undoKey(reader);
    expect([reader.state.doc.toString(), writer.state.doc.toString()]).toEqual([typed, typed]);
    expect(document.dirty).toBe(true);
  });
});

describe('a write settles', () => {
  test('pending after a settled write holds only what was typed since, against the written text', () => {
    const { document, view } = open();
    typeAtEndOf(view, 1, ' first');
    const written = document.pending();
    const disk = applied(BASE, written.edits);
    typeAtEndOf(view, 7, ' second');

    expect(document.settled(written, 'disk-2')).toBe(true);

    const later = document.pending();
    expect(later.digest).toBe('disk-2');
    expect(later.edits).toEqual([{ from: 7, to: 8, lines: ['line 7 second'] }]);
    expect(applied(disk, later.edits)).toBe(view.state.doc.toString());
  });
});
