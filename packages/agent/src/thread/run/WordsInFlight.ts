import { Context, Layer } from 'effect';
import type { ThreadRunRef } from './ThreadRunLedger';

export class WordsInFlight extends Context.Service<
  WordsInFlight,
  {
    handed(run: ThreadRunRef, ids: readonly string[]): void;
    settled(run: ThreadRunRef, ids: readonly string[]): void;
    returned(run: ThreadRunRef): void;
    live(runId: string): boolean;
    onDrained(listener: (run: ThreadRunRef) => void): () => void;
  }
>()('@runlith/agent/WordsInFlight') {}

export const wordsInFlightLayer: Layer.Layer<WordsInFlight> = Layer.sync(WordsInFlight, () => {
  const standing = new Map<string, { readonly run: ThreadRunRef; readonly ids: Set<string> }>();
  const listeners = new Set<(run: ThreadRunRef) => void>();
  return {
    handed: (run, ids) => {
      if (ids.length === 0) return;
      const held = standing.get(run.id) ?? { run, ids: new Set<string>() };
      for (const id of ids) held.ids.add(id);
      standing.set(run.id, held);
    },
    settled: (run, ids) => {
      const held = standing.get(run.id);
      if (held === undefined) return;
      for (const id of ids) held.ids.delete(id);
      if (held.ids.size > 0) return;
      standing.delete(run.id);
      for (const listener of listeners) listener(held.run);
    },
    returned: (run) => {
      const held = standing.get(run.id);
      if (held === undefined) return;
      standing.delete(run.id);
      for (const listener of listeners) listener(held.run);
    },
    live: (runId) => standing.has(runId),
    onDrained: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
});
