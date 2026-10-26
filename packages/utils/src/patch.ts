import { spansOf } from './charSpans.js';
import { alignLines } from './lineAlign.js';
import { type Change, type Deadline, deadlineIn } from './sequenceDiff.js';

export type PatchSpan = { readonly start: number; readonly end: number };

const NO_SPANS: readonly PatchSpan[] = [];

export type TextPatch = {
  readonly patch: string;
  readonly hunks: readonly PatchHunk[];
  readonly added: number;
  readonly removed: number;
  readonly timedOut: boolean;
};

export type TextPatchOptions = { readonly context?: number; readonly deadlineMs?: number };

export const PATCH_CONTEXT_LINES = 3;

const PATCH_DEADLINE_MS = 300;

type PatchOp = { readonly kind: ' ' | '-' | '+'; readonly text: string; readonly spans: readonly PatchSpan[] };

function comparedLines(before: string, after: string, deadline: Deadline) {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  let head = 0;
  while (head < beforeLines.length && head < afterLines.length && beforeLines[head] === afterLines[head]) head += 1;
  let tail = 0;
  while (
    tail < beforeLines.length - head &&
    tail < afterLines.length - head &&
    beforeLines[beforeLines.length - 1 - tail] === afterLines[afterLines.length - 1 - tail]
  ) {
    tail += 1;
  }
  const midBefore = beforeLines.slice(head, beforeLines.length - tail);
  const midAfter = afterLines.slice(head, afterLines.length - tail);
  const middle = alignLines(midBefore, midAfter, deadline);
  return { beforeLines, afterLines, head, tail, midBefore, midAfter, middle };
}

export function textChanges(
  before: string,
  after: string,
  options: TextPatchOptions = {},
): {
  readonly changes: readonly Change[];
  readonly added: number;
  readonly removed: number;
  readonly timedOut: boolean;
} {
  const { head, middle } = comparedLines(before, after, deadlineIn(options.deadlineMs ?? PATCH_DEADLINE_MS));
  let added = 0;
  let removed = 0;
  const changes = middle.changes.map((change) => {
    removed += change.before.end - change.before.start;
    added += change.after.end - change.after.start;
    return {
      before: { start: change.before.start + head, end: change.before.end + head },
      after: { start: change.after.start + head, end: change.after.end + head },
    };
  });
  return { changes, added, removed, timedOut: middle.timedOut };
}

export function textPatch(before: string, after: string, options: TextPatchOptions = {}): TextPatch {
  const deadline = deadlineIn(options.deadlineMs ?? PATCH_DEADLINE_MS);
  const { beforeLines, head, tail, midBefore, midAfter, middle } = comparedLines(before, after, deadline);
  const marked = opsFrom(midBefore, midAfter, middle.changes, deadline);
  const ops: PatchOp[] = [
    ...beforeLines.slice(0, head).map((text): PatchOp => ({ kind: ' ', text, spans: NO_SPANS })),
    ...marked.ops,
    ...beforeLines.slice(beforeLines.length - tail).map((text): PatchOp => ({ kind: ' ', text, spans: NO_SPANS })),
  ];
  const windows = hunkWindows(ops, options.context ?? PATCH_CONTEXT_LINES);
  const starts = opStarts(ops);
  return {
    patch: renderHunks(ops, windows, starts),
    hunks: hunksFrom(ops, windows, starts),
    added: ops.filter((op) => op.kind === '+').length,
    removed: ops.filter((op) => op.kind === '-').length,
    timedOut: middle.timedOut || marked.timedOut,
  };
}

function splitLines(text: string): readonly string[] {
  return text.length === 0 ? [] : text.split('\n');
}

function opsFrom(
  before: readonly string[],
  after: readonly string[],
  changes: readonly Change[],
  deadline: Deadline,
): { readonly ops: PatchOp[]; readonly timedOut: boolean } {
  const ops: PatchOp[] = [];
  let atBefore = 0;
  let atAfter = 0;
  let timedOut = false;
  for (const change of changes) {
    for (let at = 0; at < change.before.start - atBefore; at += 1) {
      ops.push({ kind: ' ', text: after[atAfter + at] as string, spans: NO_SPANS });
    }
    const removed = change.before.end - change.before.start;
    const added = change.after.end - change.after.start;
    const marks: { readonly before: readonly PatchSpan[]; readonly after: readonly PatchSpan[] }[] = [];
    for (let at = 0; at < Math.min(removed, added); at += 1) {
      const pair = spansOf(before[change.before.start + at] as string, after[change.after.start + at] as string, deadline);
      timedOut = timedOut || pair.timedOut;
      marks.push(pair);
    }
    for (let at = 0; at < removed; at += 1) {
      ops.push({ kind: '-', text: before[change.before.start + at] as string, spans: marks[at]?.before ?? NO_SPANS });
    }
    for (let at = 0; at < added; at += 1) {
      ops.push({ kind: '+', text: after[change.after.start + at] as string, spans: marks[at]?.after ?? NO_SPANS });
    }
    atBefore = change.before.end;
    atAfter = change.after.end;
  }
  for (let at = atAfter; at < after.length; at += 1) {
    ops.push({ kind: ' ', text: after[at] as string, spans: NO_SPANS });
  }
  return { ops, timedOut };
}

type HunkWindow = { readonly from: number; readonly to: number };

function hunkWindows(ops: readonly PatchOp[], context: number): readonly HunkWindow[] {
  const changed = ops.flatMap((op, index) => (op.kind === ' ' ? [] : [index]));
  const windows: HunkWindow[] = [];
  let cursor = 0;
  while (cursor < changed.length) {
    const first = changed[cursor] as number;
    let last = first;
    while (cursor + 1 < changed.length && (changed[cursor + 1] as number) - last <= context * 2 + 1) {
      cursor += 1;
      last = changed[cursor] as number;
    }
    cursor += 1;
    windows.push({ from: Math.max(0, first - context), to: Math.min(ops.length - 1, last + context) });
  }
  return windows;
}

function opStarts(ops: readonly PatchOp[]): readonly { readonly before: number; readonly after: number }[] {
  let beforeLine = 1;
  let afterLine = 1;
  return ops.map((op) => {
    const at = { before: beforeLine, after: afterLine };
    if (op.kind !== '+') beforeLine += 1;
    if (op.kind !== '-') afterLine += 1;
    return at;
  });
}

function renderHunks(
  ops: readonly PatchOp[],
  windows: readonly HunkWindow[],
  starts: readonly { readonly before: number; readonly after: number }[],
): string {
  const lines: string[] = [];
  for (const window of windows) {
    const held = ops.slice(window.from, window.to + 1);
    const start = starts[window.from] as { before: number; after: number };
    const removedCount = held.filter((op) => op.kind !== '+').length;
    const addedCount = held.filter((op) => op.kind !== '-').length;
    lines.push(`@@ -${start.before},${removedCount} +${start.after},${addedCount} @@`);
    for (const op of held) lines.push(`${op.kind}${op.text}`);
  }
  return lines.join('\n');
}

function hunksFrom(
  ops: readonly PatchOp[],
  windows: readonly HunkWindow[],
  starts: readonly { readonly before: number; readonly after: number }[],
): readonly PatchHunk[] {
  return windows.map((window, index) => {
    const start = starts[window.from] as { before: number; after: number };
    const above = windows[index - 1];
    const opens = above === undefined ? 0 : above.to + 1;
    return {
      beforeStart: start.before,
      afterStart: start.after,
      hiddenBefore: window.from - opens,
      hiddenAt: window.from === opens ? 0 : (starts[opens] as { before: number }).before,
      lines: ops.slice(window.from, window.to + 1).map((op, at): PatchLine => {
        const place = starts[window.from + at] as { before: number; after: number };
        return {
          kind: op.kind === ' ' ? 'context' : op.kind === '-' ? 'removed' : 'added',
          text: op.text,
          before: op.kind === '+' ? null : place.before,
          after: op.kind === '-' ? null : place.after,
          spans: op.spans,
        };
      }),
    };
  });
}

export type PatchLine = {
  readonly kind: 'context' | 'added' | 'removed';
  readonly text: string;
  readonly before: number | null;
  readonly after: number | null;
  readonly spans: readonly PatchSpan[];
};

export type PatchHunk = {
  readonly beforeStart: number;
  readonly afterStart: number;
  readonly hiddenBefore: number;
  readonly hiddenAt: number;
  readonly lines: readonly PatchLine[];
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseTextPatch(patch: string): readonly PatchHunk[] {
  const hunks: PatchHunk[] = [];
  let lines: PatchLine[] = [];
  let beforeStart = 0;
  let afterStart = 0;
  let before = 0;
  let after = 0;
  let past = 1;
  const close = () => {
    if (lines.length > 0) {
      const hiddenBefore = beforeStart - past;
      hunks.push({ beforeStart, afterStart, hiddenBefore, hiddenAt: hiddenBefore === 0 ? 0 : past, lines });
      past = before;
    }
    lines = [];
  };
  for (const line of patch.split('\n')) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      close();
      beforeStart = Number(header[1]);
      afterStart = Number(header[2]);
      before = beforeStart;
      after = afterStart;
      continue;
    }
    if (hunks.length === 0 && lines.length === 0 && beforeStart === 0) continue;
    const sign = line.charAt(0);
    const text = line.slice(1);
    if (sign === '-') {
      lines.push({ kind: 'removed', text, before, after: null, spans: NO_SPANS });
      before += 1;
      continue;
    }
    if (sign === '+') {
      lines.push({ kind: 'added', text, before: null, after, spans: NO_SPANS });
      after += 1;
      continue;
    }
    lines.push({ kind: 'context', text, before, after, spans: NO_SPANS });
    before += 1;
    after += 1;
  }
  close();
  return hunks;
}
