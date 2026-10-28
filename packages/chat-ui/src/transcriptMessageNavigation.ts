export type MessageOffsetTarget = { kind: 'message'; id: string } | { kind: 'latest' } | { kind: 'none' };

export function messageOffsetTarget(input: { currentId?: string; ids: readonly string[]; offset: number }): MessageOffsetTarget {
  if (input.ids.length === 0) return { kind: 'none' };

  const baseIndex = input.currentId ? input.ids.indexOf(input.currentId) : input.ids.length;
  const currentIndex = baseIndex === -1 ? input.ids.length : baseIndex;
  const targetIndex = currentIndex + input.offset;
  if (targetIndex < 0 || targetIndex > input.ids.length) return { kind: 'none' };
  if (targetIndex === input.ids.length) return { kind: 'latest' };
  return {
    id: input.ids[targetIndex]!,
    kind: 'message',
  };
}
