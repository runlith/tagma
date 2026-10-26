import type { LineEdit, LineEditsRefused } from '@runlith/files/lines';
import type { DocumentColours } from './document';
import type { SessionAnswer, SessionRequest } from './session.worker';

export type SessionEvent =
  | ({ kind: 'colours' } & DocumentColours)
  | { kind: 'plain' }
  | { kind: 'refused'; version: number; reason: LineEditsRefused }
  | { kind: 'failed'; message: string };

export type DocumentSession = {
  edit(version: number, edits: readonly LineEdit[]): void;
  viewport(from: number, to: number): void;
  close(): void;
};

let worker: Worker | undefined;
let nextSession = 0;
const listeners = new Map<number, (event: SessionEvent) => void>();

function failAll(message: string): void {
  worker = undefined;
  const standing = [...listeners.values()];
  listeners.clear();
  for (const listener of standing) listener({ kind: 'failed', message });
}

function ensureWorker(): Worker | undefined {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return undefined;
  const started = new Worker(new URL('./session.worker.ts', import.meta.url), { type: 'module' });
  started.addEventListener('message', (event: MessageEvent<SessionAnswer>) => {
    const { id, ...answer } = event.data;
    listeners.get(id)?.(answer);
  });
  started.addEventListener('error', (event) => failAll(event.message || 'The highlight worker failed'));
  started.addEventListener('messageerror', () => failAll('The highlight worker sent a message that could not be read'));
  worker = started;
  return worker;
}

export function openSession(
  text: string,
  language: string | undefined,
  version: number,
  onEvent: (event: SessionEvent) => void,
): DocumentSession | undefined {
  const thread = ensureWorker();
  if (!thread) return undefined;
  const id = ++nextSession;
  const post = (request: SessionRequest) => thread.postMessage(request);
  listeners.set(id, onEvent);
  post({ kind: 'open', id, version, text, language });
  return {
    edit: (next, edits) => post({ kind: 'edit', id, version: next, edits }),
    viewport: (from, to) => post({ kind: 'viewport', id, from, to }),
    close() {
      listeners.delete(id);
      post({ kind: 'close', id });
    },
  };
}
