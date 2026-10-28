export const READING_LINE_PX = 100;

export type ReadingView = {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly clearance: number;
};

export function readingLine(view: ReadingView): number {
  const visible = Math.max(1, view.clientHeight - view.clearance);
  const remaining = Math.max(0, view.scrollHeight - view.clientHeight - view.scrollTop);
  const end = visible - 1;
  return view.scrollTop + end + (READING_LINE_PX - end) * Math.min(1, remaining / visible);
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
