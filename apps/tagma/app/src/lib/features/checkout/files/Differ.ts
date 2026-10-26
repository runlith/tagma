import type { DiffAnswer, DiffRequest } from './lineDiff.worker.js';
import type { LineEdit } from './lineDiff.js';

export type DiffEngine = (before: string, after: string) => Promise<readonly LineEdit[]>;

export class DiffUnavailable extends Error {
  constructor(reason: string) {
    super(`The line diff could not run: ${reason}`);
    this.name = 'DiffUnavailable';
  }
}

export function engineOver(start: () => Worker): DiffEngine {
  let worker: Worker | undefined;
  let next = 0;
  const waiting = new Map<number, { resolve(edits: readonly LineEdit[]): void; reject(error: DiffUnavailable): void }>();
  const lost = (reason: string): void => {
    for (const asked of waiting.values()) asked.reject(new DiffUnavailable(reason));
    waiting.clear();
    worker = undefined;
  };
  const open = (): Worker => {
    const made = start();
    made.addEventListener('message', (event: MessageEvent<DiffAnswer>) => {
      const asked = waiting.get(event.data.id);
      waiting.delete(event.data.id);
      asked?.resolve(event.data.edits);
    });
    made.addEventListener('error', (event) => lost(`the worker stopped: ${event.message}`));
    return made;
  };
  return (before, after) =>
    new Promise((resolve, reject) => {
      try {
        worker ??= open();
        const id = (next += 1);
        waiting.set(id, { resolve, reject });
        worker.postMessage({ id, before, after } satisfies DiffRequest);
      } catch (failure) {
        reject(failure instanceof DiffUnavailable ? failure : new DiffUnavailable(String(failure)));
      }
    });
}

export const workerEngine = (): DiffEngine =>
  engineOver(() => {
    if (typeof Worker === 'undefined') throw new DiffUnavailable('this page has no workers');
    return new Worker(new URL('./lineDiff.worker.ts', import.meta.url), { type: 'module' });
  });

export class Differ {
  private readonly turns = new Map<string, number>();

  constructor(private readonly engine: DiffEngine = workerEngine()) {}

  release(asker: string): void {
    this.turns.delete(asker);
  }

  async edits(before: string, after: string, asker: string): Promise<readonly LineEdit[] | null> {
    const turn = (this.turns.get(asker) ?? 0) + 1;
    this.turns.set(asker, turn);
    const edits = await this.engine(before, after);
    return this.turns.get(asker) === turn ? edits : null;
  }
}
