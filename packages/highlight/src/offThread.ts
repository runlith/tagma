import { highlightCode, highlightLines, type CodeColours } from './colours';
import type { HighlightAnswer, HighlightRequest } from './worker';

type Asked = Extract<HighlightRequest, { kind: 'html' | 'lines' }>;

type Reply = { kind: 'answer'; answer: HighlightAnswer } | { kind: 'superseded' } | { kind: 'unavailable' };

type Waiter = { asker: string | undefined; resolve(reply: Reply): void };

type Pending = { request: Asked; waiting: Waiter[] };

let worker: Worker | undefined;
let started = false;
let nextRequest = 0;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker | undefined {
  if (started) return worker;
  started = true;
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return undefined;
  try {
    const started = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    started.addEventListener('message', (event: MessageEvent<HighlightAnswer>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      for (const waiter of entry.waiting) waiter.resolve({ kind: 'answer', answer: event.data });
    });
    started.addEventListener('error', () => {
      worker = undefined;
      for (const [id, entry] of pending) {
        pending.delete(id);
        for (const waiter of entry.waiting) waiter.resolve({ kind: 'unavailable' });
      }
    });
    worker = started;
  } catch {
    worker = undefined;
  }
  return worker;
}

export async function highlightCodeOffThread(code: string, language: string | undefined): Promise<string> {
  const reply = await ask({ id: ++nextRequest, kind: 'html', code, language }, undefined);
  if (reply.kind === 'answer' && reply.answer.kind === 'html') return reply.answer.html;
  return highlightCode(code, language);
}

export async function highlightLinesOffThread(code: string, language: string | undefined, asker: string): Promise<CodeColours | undefined> {
  const reply = await ask({ id: ++nextRequest, kind: 'lines', code, language }, asker);
  if (reply.kind === 'superseded') return undefined;
  if (reply.kind === 'answer' && reply.answer.kind === 'lines') return reply.answer.lines;
  return highlightLines(code, language);
}

async function ask(request: Asked, asker: string | undefined): Promise<Reply> {
  const thread = ensureWorker();
  if (!thread) return { kind: 'unavailable' };
  if (asker !== undefined) supersede(asker, thread);
  const standing = sharing(request);
  if (standing) return await new Promise<Reply>((resolve) => standing.waiting.push({ asker, resolve }));
  return await new Promise<Reply>((resolve) => {
    pending.set(request.id, { request, waiting: [{ asker, resolve }] });
    thread.postMessage(request);
  });
}

function sharing(request: Asked): Pending | undefined {
  for (const entry of pending.values()) {
    const standing = entry.request;
    const same = standing.kind === request.kind && standing.code === request.code && standing.language === request.language;
    if (same) return entry;
  }
  return undefined;
}

function supersede(asker: string, thread: Worker): void {
  for (const [id, entry] of pending) {
    const mine = entry.waiting.filter((waiter) => waiter.asker === asker);
    if (mine.length === 0 || mine.length < entry.waiting.length) continue;
    pending.delete(id);
    for (const waiter of mine) waiter.resolve({ kind: 'superseded' });
    thread.postMessage({ kind: 'drop', id } satisfies HighlightRequest);
  }
}
