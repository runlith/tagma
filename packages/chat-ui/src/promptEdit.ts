export type PromptEdit = { readonly from: number; readonly to: number; readonly text: string };

export function editOf(before: string, from: number, to: number, after: string, caret: number): PromptEdit | null {
  const at = Math.min(from, to, caret);
  const inserted = caret - at;
  const removed = inserted - (after.length - before.length);
  if (inserted < 0 || removed < 0 || at + removed > before.length) return null;
  if (before.slice(0, at) !== after.slice(0, at) || before.slice(at + removed) !== after.slice(at + inserted)) return null;
  return { from: at, to: at + removed, text: after.slice(at, at + inserted) };
}
