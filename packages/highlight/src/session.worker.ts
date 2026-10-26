import type { LineEdit, LineEditsRefused } from '@runlith/files/lines';
import { type DocumentColours, TokenDocument } from './document';
import { lineTokenizerFor } from './grammar';

export type SessionRequest =
  | { kind: 'open'; id: number; version: number; text: string; language: string | undefined }
  | { kind: 'edit'; id: number; version: number; edits: readonly LineEdit[] }
  | { kind: 'viewport'; id: number; from: number; to: number }
  | { kind: 'close'; id: number };

export type SessionAnswer =
  | ({ kind: 'colours'; id: number } & DocumentColours)
  | { kind: 'plain'; id: number }
  | { kind: 'refused'; id: number; version: number; reason: LineEditsRefused }
  | { kind: 'failed'; id: number; message: string };

type Following = Exclude<SessionRequest, { kind: 'open' | 'close' }>;

const live = new Map<number, TokenDocument>();
const loading = new Map<number, Following[]>();
let running = false;

const answer = (reply: SessionAnswer): void => self.postMessage(reply);

self.addEventListener('message', (event: MessageEvent<SessionRequest>) => {
  const request = event.data;
  if (request.kind === 'open') open(request);
  else if (request.kind === 'close') {
    live.delete(request.id);
    loading.delete(request.id);
  } else {
    const document = live.get(request.id);
    if (document) follow(request.id, document, request);
    else loading.get(request.id)?.push(request);
  }
});

function open({ id, version, text, language }: Extract<SessionRequest, { kind: 'open' }>): void {
  if (live.has(id) || loading.has(id)) {
    answer({ kind: 'failed', id, message: `Session ${id} is already open` });
    return;
  }
  loading.set(id, []);
  lineTokenizerFor(language).then(
    (tokenizer) => {
      const queued = loading.get(id);
      if (!queued) return;
      loading.delete(id);
      if (!tokenizer) {
        answer({ kind: 'plain', id });
        return;
      }
      const document = new TokenDocument(tokenizer, text, version);
      live.set(id, document);
      for (const request of queued) follow(id, document, request);
      void run();
    },
    (error: unknown) => {
      if (loading.delete(id)) answer({ kind: 'failed', id, message: error instanceof Error ? error.message : String(error) });
    },
  );
}

function follow(id: number, document: TokenDocument, request: Following): void {
  if (request.kind === 'viewport') document.viewport(request.from, request.to);
  else {
    const reason = document.edit(request.version, request.edits);
    if (reason !== undefined) answer({ kind: 'refused', id, version: request.version, reason });
  }
  void run();
}

async function run(): Promise<void> {
  if (running) return;
  running = true;
  for (;;) {
    let worked = false;
    for (const [id, document] of live) {
      if (!document.busy) continue;
      worked = true;
      const chunk = document.step();
      if (chunk) answer({ kind: 'colours', id, ...chunk });
    }
    if (!worked) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  running = false;
}
