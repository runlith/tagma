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
