export const READING_LINE_PX = 100;

export type ReadingView = {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly clearance: number;
  readonly endGap: number;
};

export function visibleHeight(view: ReadingView): number {
  return Math.max(1, view.clientHeight - view.clearance);
}

export function readingLine(view: ReadingView): number {
  const visible = visibleHeight(view);
  const end = visible - 1;
  const fixed = Math.min(READING_LINE_PX, visible / 2);
  return view.scrollTop + end + (fixed - end) * Math.min(1, Math.max(0, view.endGap) / visible);
}

export function inView(view: ReadingView, span: { readonly start: number; readonly end: number }): boolean {
  return span.end > view.scrollTop && span.start < view.scrollTop + visibleHeight(view);
}

export function transcriptCursorMessageId(input: {
  messages: readonly { readonly id: string }[];
  rowOf(id: string): number;
  row: number;
}): string | undefined {
  let low = 0;
  let high = input.messages.length - 1;
  let found: string | undefined;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const id = input.messages[middle]!.id;
    if (input.rowOf(id) <= input.row) {
      found = id;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
