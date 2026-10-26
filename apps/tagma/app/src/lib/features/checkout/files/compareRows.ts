import type { DiffLine, DiffKind } from '@runlith/code-editor/marks';
import type { LineEdit } from './lineDiff.js';

function row(kind: DiffKind, text: string, before: number | null, after: number | null): DiffLine {
  return { kind, text, before, after, mark: null, spans: [], hiddenBefore: 0, hiddenAt: 0 };
}

export function compareRows(disk: string, edits: readonly LineEdit[]): readonly DiffLine[] {
  const old = disk.split('\n');
  const rows: DiffLine[] = [];
  let before = 0;
  let after = 0;
  const same = (until: number): void => {
    for (; before < until; before += 1, after += 1) rows.push(row('context', old[before] as string, before + 1, after + 1));
  };
  for (const edit of edits) {
    same(edit.from);
    for (; before < edit.to; before += 1) rows.push(row('removed', old[before] as string, before + 1, null));
    for (const line of edit.lines) {
      rows.push(row('added', line, null, after + 1));
      after += 1;
    }
  }
  same(old.length);
  return rows;
}
