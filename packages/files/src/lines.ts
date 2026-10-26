import { Result } from 'effect';

export type LineEdit = {
  readonly from: number;
  readonly to: number;
  readonly lines: readonly string[];
};

export type LineEditsRefused = 'range' | 'order' | 'line';

const BOM = '\uFEFF';

export function splitLines(text: string): readonly string[] {
  const lines: string[] = [];
  let start = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', start)) {
    lines.push(text.slice(start, at + 1));
    start = at + 1;
  }
  lines.push(text.slice(start));
  return lines;
}

export const lineBody = (line: string): string =>
  line.endsWith('\r\n') ? line.slice(0, -2) : line.endsWith('\n') ? line.slice(0, -1) : line;

export const splitBodies = (text: string): string[] => splitLines(text.startsWith(BOM) ? text.slice(BOM.length) : text).map(lineBody);

const endOf = (line: string): string => line.slice(lineBody(line).length);

function prevailingEnd(lines: readonly string[]): string {
  let crlf = 0;
  let lf = 0;
  for (const line of lines) {
    const end = endOf(line);
    if (end === '\r\n') crlf += 1;
    else if (end === '\n') lf += 1;
  }
  return crlf > lf ? '\r\n' : '\n';
}

export function checkLineEdits(lineCount: number, edits: readonly LineEdit[]): LineEditsRefused | undefined {
  let floor = 0;
  for (const edit of edits) {
    if (!Number.isInteger(edit.from) || !Number.isInteger(edit.to) || edit.from < 0 || edit.to < edit.from || edit.to > lineCount) {
      return 'range';
    }
    if (edit.from < floor) return 'order';
    const last = edit.to === lineCount ? edit.lines.length - 1 : -1;
    if (edit.lines.some((body, at) => body.includes('\n') || (at !== last && body.endsWith('\r')))) return 'line';
    floor = edit.to;
  }
  return undefined;
}

export function applyLineEdits(base: string, edits: readonly LineEdit[]): Result.Result<string, LineEditsRefused> {
  const bom = base.startsWith(BOM);
  const lines = splitLines(bom ? base.slice(BOM.length) : base);
  const refused = checkLineEdits(lines.length, edits);
  if (refused !== undefined) return Result.fail(refused);
  const end = prevailingEnd(lines);
  const bodies: string[] = [];
  const ends: string[] = [];
  let at = 0;
  const copy = (until: number): void => {
    for (; at < until; at += 1) {
      const line = lines[at] as string;
      bodies.push(lineBody(line));
      ends.push(endOf(line));
    }
  };
  for (const edit of edits) {
    copy(edit.from);
    for (const body of edit.lines) {
      bodies.push(body);
      ends.push('');
    }
    at = edit.to;
  }
  copy(lines.length);
  let text = bom ? BOM : '';
  const last = bodies.length - 1;
  for (let line = 0; line < last; line += 1) text += (bodies[line] as string) + ((ends[line] as string) || end);
  if (last >= 0) text += bodies[last] as string;
  return Result.succeed(text);
}
