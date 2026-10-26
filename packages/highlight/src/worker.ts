import { highlightCode, highlightLineSlices, type CodeColours } from './colours';

export type HighlightRequest =
  | { kind: 'drop'; id: number }
  | { id: number; kind: 'html'; code: string; language: string | undefined }
  | { id: number; kind: 'lines'; code: string; language: string | undefined };

export type HighlightAnswer = { id: number; kind: 'html'; html: string } | { id: number; kind: 'lines'; lines: CodeColours };

type QueuedRequest = Exclude<HighlightRequest, { kind: 'drop' }>;

type Job = { id: number; step(): Promise<HighlightAnswer | undefined> };

const queued: Job[] = [];
let draining = false;

self.addEventListener('message', (event: MessageEvent<HighlightRequest>) => {
  const request = event.data;
  if (request.kind === 'drop') {
    const at = queued.findIndex((waiting) => waiting.id === request.id);
    if (at >= 0) queued.splice(at, 1);
    return;
  }
  queued.push(job(request));
  void drain();
});

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  await turn();
  let current = queued[0];
  while (current) {
    const answer = await current.step();
    const at = queued.indexOf(current);
    if (at >= 0) {
      queued.splice(at, 1);
      if (answer) self.postMessage(answer);
      else queued.push(current);
    }
    await turn();
    current = queued[0];
  }
  draining = false;
}

function turn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function job(request: QueuedRequest): Job {
  const { id, code, language } = request;
  if (request.kind === 'html') {
    return { id, step: async () => ({ id, kind: 'html', html: await highlightCode(code, language) }) };
  }
  const slices = highlightLineSlices(code, language);
  const lines: CodeColours = new Map();
  return {
    id,
    async step() {
      const next = await slices.next();
      if (next.done) return { id, kind: 'lines', lines };
      for (const [at, line] of next.value.colours) lines.set(at, line);
      return next.value.last ? { id, kind: 'lines', lines } : undefined;
    },
  };
}
