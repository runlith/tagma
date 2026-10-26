import { WorkerUnavailable, eventReason, workerGone } from '@runlith/utils/worker';

export const PDF_MAX_BYTES = 64 * 1024 * 1024;
export const PDF_WINDOW_PAGES = 20;
export const PDF_PAGE_FRAME = 160;

export type PdfWindow = { readonly first: number; readonly last: number | undefined };

export type PdfRequest = {
  readonly id: number;
  bytes: ArrayBuffer | undefined;
  readonly window: PdfWindow;
  readonly maxTextBytes: number;
  readonly stop: Int32Array;
};

export type PdfPageState = 'text' | 'cut' | 'shown' | 'deferred' | 'undrawn' | 'unreadable';

export type PdfPage = { readonly page: number; readonly text: string; readonly state: PdfPageState };

export type PdfPixels = { readonly page: number; readonly width: number; readonly height: number; readonly rgba: Uint8Array };

type PdfWindowRead<P> = {
  readonly status: 'read';
  readonly pageCount: number;
  readonly first: number;
  readonly last: number;
  readonly pages: readonly PdfPage[];
  readonly pictures: readonly P[];
  readonly next: number | null;
};

type PdfRefused = { readonly status: 'refused'; readonly reason: string };

export type PdfPages = PdfWindowRead<PdfPixels> | PdfRefused;

export type PdfAnswer =
  | { readonly id: number; readonly pages: PdfPages; readonly grown: boolean }
  | { readonly id: number; readonly failed: string; readonly grown: boolean };

export type PdfPicture = { readonly page: number; readonly png: Uint8Array };

export type PdfReading = PdfWindowRead<PdfPicture> | PdfRefused;

type BunWorker = Worker & { ref(): void; unref(): void };

type Held = {
  readonly worker: BunWorker;
  readonly waiting: Map<number, (reply: PdfAnswer | WorkerUnavailable) => void>;
  grown: boolean;
  idle(): void;
  fail(reason: string): void;
};

let held: Held | undefined;
let nextId = 0;

const WORKER = 'PDF worker';

function thread(): Held {
  if (held !== undefined) return held;
  let worker: BunWorker;
  try {
    worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' }) as BunWorker;
  } catch (cause) {
    throw workerGone(WORKER, `it could not start: ${String(cause)}`);
  }
  const waiting = new Map<number, (reply: PdfAnswer | WorkerUnavailable) => void>();
  const end = (reason: string | null) => {
    if (held !== started) return;
    held = undefined;
    worker.terminate();
    const gone = reason === null ? null : workerGone(WORKER, reason);
    if (gone !== null) for (const settle of [...waiting.values()]) settle(gone);
    waiting.clear();
  };
  const started: Held = {
    worker,
    waiting,
    grown: false,
    fail: end,
    idle: () => {
      if (waiting.size > 0) return;
      if (started.grown) end(null);
      else worker.unref();
    },
  };
  worker.addEventListener('message', (event: MessageEvent<PdfAnswer>) => {
    if (event.data.grown) started.grown = true;
    const settle = waiting.get(event.data.id);
    waiting.delete(event.data.id);
    settle?.(event.data);
    started.idle();
  });
  worker.addEventListener('error', (event: ErrorEvent) => end(eventReason(event, 'the worker failed')));
  worker.addEventListener('messageerror', () => end('an answer could not be read'));
  worker.addEventListener('close', () => end('the worker closed'));
  held = started;
  return started;
}

function owned(bytes: Uint8Array): ArrayBuffer {
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer;
  return whole ? (bytes.buffer as ArrayBuffer) : (bytes.slice().buffer as ArrayBuffer);
}

export async function readPdf(bytes: Uint8Array, window: PdfWindow, maxTextBytes: number, signal?: AbortSignal): Promise<PdfReading> {
  signal?.throwIfAborted();
  const running = thread();
  const id = ++nextId;
  const stop = new Int32Array(new SharedArrayBuffer(4));
  const buffer = owned(bytes);
  const reply = await new Promise<PdfAnswer | WorkerUnavailable>((resolve, reject) => {
    const forget = () => {
      running.waiting.delete(id);
      running.idle();
    };
    const stopped = () => {
      Atomics.store(stop, 0, 1);
      forget();
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', stopped, { once: true });
    running.waiting.set(id, (answered) => {
      signal?.removeEventListener('abort', stopped);
      resolve(answered);
    });
    running.worker.ref();
    try {
      running.worker.postMessage({ id, bytes: buffer, window, maxTextBytes, stop } satisfies PdfRequest, [buffer]);
    } catch (cause) {
      running.fail(`it took no ask: ${String(cause)}`);
    }
  });
  if (reply instanceof WorkerUnavailable) throw reply;
  if ('failed' in reply) throw new Error(reply.failed);
  return encoded(reply.pages);
}

async function encoded(pages: PdfPages): Promise<PdfReading> {
  if (pages.status === 'refused') return pages;
  if (pages.pictures.length === 0) return { ...pages, pictures: [] };
  const { default: sharp } = await import('sharp');
  const pictures: PdfPicture[] = [];
  const undrawn = new Set<number>();
  for (const picture of pages.pictures) {
    try {
      const png = await sharp(picture.rgba, { raw: { width: picture.width, height: picture.height, channels: 4 } })
        .removeAlpha()
        .png()
        .toBuffer();
      pictures.push({ page: picture.page, png });
    } catch {
      undrawn.add(picture.page);
    }
  }
  const drawn =
    undrawn.size === 0 ? pages.pages : pages.pages.map((page) => (undrawn.has(page.page) ? { ...page, state: 'undrawn' as const } : page));
  return { ...pages, pages: drawn, pictures };
}
