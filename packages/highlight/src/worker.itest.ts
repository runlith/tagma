import { afterAll, describe, expect, test } from 'bun:test';
import type { HighlightAnswer, HighlightRequest } from './worker';

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const answered: number[] = [];
const waiting = new Map<number, () => void>();

worker.addEventListener('message', (event: MessageEvent<HighlightAnswer>) => {
  answered.push(event.data.id);
  waiting.get(event.data.id)?.();
  waiting.delete(event.data.id);
});

function post(request: HighlightRequest): void {
  worker.postMessage(request);
}

function landing(id: number): Promise<void> {
  return new Promise((resolve) => waiting.set(id, resolve));
}

function file(index: number): string {
  return `export const file${index} = ${index};\n`.repeat(60);
}

afterAll(() => worker.terminate());

describe('the worker tokenizes nothing that was dropped', () => {
  test('leaves a dropped ask unanswered and answers the one behind it', async () => {
    post({ id: 1, kind: 'lines', code: file(1), language: 'typescript' });
    await landing(1);

    post({ id: 2, kind: 'lines', code: file(2), language: 'typescript' });
    post({ id: 3, kind: 'lines', code: file(3), language: 'typescript' });
    post({ kind: 'drop', id: 2 });
    await landing(3);

    expect(answered).toContain(3);
    expect(answered).not.toContain(2);
  });

  test('stops a dropped ask it had already started, at its next slice', async () => {
    const huge = file(4).repeat(100);
    post({ id: 4, kind: 'lines', code: huge, language: 'typescript' });
    post({ id: 5, kind: 'lines', code: file(5), language: 'typescript' });
    await landing(5);

    post({ kind: 'drop', id: 4 });
    post({ id: 6, kind: 'lines', code: huge, language: 'typescript' });
    await landing(6);

    expect(answered).not.toContain(4);
  });
});
