export type TranscriptCursorItem = {
  bottom: number;
  id: string;
  top: number;
};

export function transcriptCursorMessageId(input: {
  fallback?: string;
  items: readonly TranscriptCursorItem[];
  line: number;
  viewportBottom: number;
  viewportTop: number;
}): string | undefined {
  const shown = input.items.filter((item) => item.bottom > input.viewportTop && item.top < input.viewportBottom);
  const hit = shown.find((item) => item.top <= input.line && item.bottom >= input.line);
  if (hit) return hit.id;

  const near = [...shown].sort((left, right) => {
    const leftDistance = Math.abs(left.top - input.line);
    const rightDistance = Math.abs(right.top - input.line);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    return left.top - right.top;
  })[0];
  if (near) return near.id;

  return input.items.filter((item) => item.top <= input.line).at(-1)?.id ?? input.items[0]?.id ?? input.fallback;
}
