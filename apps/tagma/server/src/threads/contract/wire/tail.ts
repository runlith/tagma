import type { PresenceTail, PresenceTailStep } from './presence.js';

function headEnd(text: string, codePoints: number): number {
  let end = 0;
  for (let left = codePoints; left > 0 && end < text.length; left -= 1) end += text.codePointAt(end)! > 0xffff ? 2 : 1;
  return end;
}

export function cutHead(text: string, drop: number): string {
  return drop <= 0 ? text : text.slice(headEnd(text, drop));
}

export function applyTail(held: PresenceTail | undefined, step: PresenceTailStep): PresenceTail | undefined {
  if (step.restart) return { runId: step.runId, entryId: step.entryId, text: step.text };
  return held === undefined ? undefined : { ...held, text: cutHead(held.text + step.text, step.drop) };
}
