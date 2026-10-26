import { afterAll, describe, expect, test } from 'bun:test';
import type { SessionAnswer, SessionRequest } from './session.worker';

const worker = new Worker(new URL('./session.worker.ts', import.meta.url), { type: 'module' });
const answers: SessionAnswer[] = [];
let wake: (() => void) | undefined;

worker.addEventListener('message', (event: MessageEvent<SessionAnswer>) => {
  answers.push(event.data);
  wake?.();
});

afterAll(() => worker.terminate());

const post = (request: SessionRequest): void => worker.postMessage(request);

async function until(id: number, found: (answer: SessionAnswer) => boolean): Promise<SessionAnswer[]> {
  while (!answers.some((answer) => answer.id === id && found(answer))) {
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }
  return answers.filter((answer) => answer.id === id);
}

const colours = (list: readonly SessionAnswer[], id: number, version: number) =>
  list.flatMap((answer) => (answer.kind === 'colours' && answer.id === id && answer.version === version ? [answer] : []));

const lineCount = (list: readonly SessionAnswer[]): number =>
  list.reduce((sum, answer) => sum + (answer.kind === 'colours' ? answer.to - answer.from : 0), 0);

describe('a session lives in the worker', () => {
  test('answers the opened viewport, then only the lines an edit changed, each under its own version', async () => {
    const text = Array.from({ length: 50 }, (_, at) => `const value${at} = ${at};`).join('\n');
    post({ kind: 'open', id: 1, version: 1, text, language: 'typescript' });
    post({ kind: 'viewport', id: 1, from: 0, to: 50 });
    await until(1, (answer) => answer.kind === 'colours' && answer.version === 1 && answer.settled && answer.to === 50);
    expect(lineCount(colours(answers, 1, 1))).toBe(50);

    post({ kind: 'edit', id: 1, version: 2, edits: [{ from: 20, to: 21, lines: ['const edited = "x";'] }] });
    await until(1, (answer) => answer.kind === 'colours' && answer.version === 2 && answer.settled);
    expect(lineCount(colours(answers, 1, 2))).toBeLessThanOrEqual(2);
    expect(colours(answers, 1, 2)[0]?.from).toBe(20);
    post({ kind: 'close', id: 1 });
  });

  test('refuses a bad edit, a second open of the same id, and says plainly when a language has no grammar', async () => {
    post({ kind: 'open', id: 2, version: 1, text: 'const value = 1;', language: 'typescript' });
    post({ kind: 'edit', id: 2, version: 3, edits: [{ from: 10, to: 99, lines: [] }] });
    const refused = await until(2, (answer) => answer.kind === 'refused');
    expect(refused.find((answer) => answer.kind === 'refused')).toMatchObject({ id: 2, version: 3, reason: 'range' });

    post({ kind: 'open', id: 2, version: 1, text: '', language: 'typescript' });
    const failed = await until(2, (answer) => answer.kind === 'failed');
    expect(failed.find((answer) => answer.kind === 'failed')).toMatchObject({ id: 2 });

    post({ kind: 'open', id: 4, version: 1, text: '+++', language: 'brainfuck' });
    const plain = await until(4, (answer) => answer.kind === 'plain');
    expect(plain.find((answer) => answer.kind === 'plain')).toMatchObject({ id: 4 });

    post({ kind: 'close', id: 2 });
  });
});
