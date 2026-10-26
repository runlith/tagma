import { diffLines, type LineEdit } from './lineDiff.js';

export type DiffRequest = { readonly id: number; readonly before: string; readonly after: string };

export type DiffAnswer = { readonly id: number; readonly edits: readonly LineEdit[] };

self.addEventListener('message', (event: MessageEvent<DiffRequest>) => {
  const { id, before, after } = event.data;
  self.postMessage({ id, edits: diffLines(before, after) } satisfies DiffAnswer);
});
