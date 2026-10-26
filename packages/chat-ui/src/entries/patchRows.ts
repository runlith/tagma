import type { PatchHunk, PatchLine } from '@runlith/utils/patch';

export type PatchRow =
  | { readonly kind: 'break'; readonly key: string; readonly hiddenBefore: number; readonly hiddenAt: number }
  | {
      readonly kind: 'line';
      readonly key: string;
      readonly hunk: number;
      readonly index: number;
      readonly at: number;
      readonly line: PatchLine;
    };

export function patchRows(hunks: readonly PatchHunk[]): readonly PatchRow[] {
  const rows: PatchRow[] = [];
  let at = 0;
  for (const [hunk, stretch] of hunks.entries()) {
    if (hunk > 0) {
      rows.push({ kind: 'break', key: `break:${hunk}`, hiddenBefore: stretch.hiddenBefore, hiddenAt: stretch.hiddenAt });
    }
    for (const [index, line] of stretch.lines.entries()) {
      rows.push({ kind: 'line', key: `${hunk}:${index}`, hunk, index, at, line });
      at += 1;
    }
  }
  return rows;
}

export function patchText(rows: readonly PatchRow[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    if (row.kind === 'line') lines.push(row.line.text);
  }
  return lines.join('\n');
}

export function gutterDigits(hunks: readonly PatchHunk[]): number {
  let widest = 1;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.before !== null && line.before > widest) widest = line.before;
      if (line.after !== null && line.after > widest) widest = line.after;
    }
  }
  return String(widest).length;
}
