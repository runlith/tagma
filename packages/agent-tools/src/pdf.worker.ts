/// <reference types="bun" />

import { readFile } from 'node:fs/promises';
import { PDF_PAGE_FRAME, PDF_WINDOW_PAGES, type PdfRequest, type PdfPage, type PdfPages, type PdfPixels, type PdfAnswer } from './pdf';

declare const self: Worker;

const PICTURES_MAX = 5;
const RENDER_LONG_SIDE = 2000;
const FPDF_ANNOT = 0x01;
const FPDF_ERR_PASSWORD = 4;

type Engine = {
  readonly pdfium: {
    readonly HEAPU8: Uint8Array;
    readonly wasmExports: { malloc(size: number): number; free(pointer: number): void };
    UTF16ToString(pointer: number): string;
  };
  PDFiumExt_Init(): void;
  FPDF_LoadMemDocument(pointer: number, size: number, password: string): number;
  FPDF_GetLastError(): number;
  FPDF_GetPageCount(document: number): number;
  FPDF_LoadPage(document: number, index: number): number;
  FPDF_ClosePage(page: number): void;
  FPDF_CloseDocument(document: number): void;
  FPDF_GetPageWidthF(page: number): number;
  FPDF_GetPageHeightF(page: number): number;
  FPDF_RenderPageBitmap(
    bitmap: number,
    page: number,
    x: number,
    y: number,
    width: number,
    height: number,
    rotate: number,
    flags: number,
  ): void;
  FPDFText_LoadPage(page: number): number;
  FPDFText_CountChars(textPage: number): number;
  FPDFText_GetText(textPage: number, start: number, count: number, buffer: number): number;
  FPDFText_ClosePage(textPage: number): void;
  FPDFBitmap_Create(width: number, height: number, alpha: number): number;
  FPDFBitmap_FillRect(bitmap: number, left: number, top: number, width: number, height: number, color: number): boolean;
  FPDFBitmap_GetBuffer(bitmap: number): number;
  FPDFBitmap_GetStride(bitmap: number): number;
  FPDFBitmap_Destroy(bitmap: number): void;
};

let loading: Promise<{ readonly engine: Engine; readonly heap: number }> | undefined;

function loaded(): Promise<{ readonly engine: Engine; readonly heap: number }> {
  loading ??= (async () => {
    const { init } = (await import('@embedpdf/pdfium')) as unknown as {
      init(overrides: { wasmBinary: ArrayBuffer }): Promise<Engine>;
    };
    const wasm = await readFile(Bun.resolveSync('@embedpdf/pdfium/pdfium.wasm', import.meta.dir));
    const engine = await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
    engine.PDFiumExt_Init();
    return { engine, heap: engine.pdfium.HEAPU8.buffer.byteLength };
  })().catch((cause: unknown) => {
    loading = undefined;
    throw cause;
  });
  return loading;
}

self.addEventListener('message', (event: MessageEvent<PdfRequest>) => {
  const ask = event.data;
  void loaded().then(
    ({ engine, heap }) => {
      const reading = read(engine, ask);
      const grown = engine.pdfium.HEAPU8.buffer.byteLength > heap;
      const moved = reading.status === 'read' ? reading.pictures.map((picture) => picture.rgba.buffer as ArrayBuffer) : [];
      self.postMessage({ id: ask.id, pages: reading, grown } satisfies PdfAnswer, moved);
    },
    (cause: unknown) => {
      self.postMessage({ id: ask.id, failed: `PDFium could not load: ${String(cause)}`, grown: false } satisfies PdfAnswer);
    },
  );
});

function read(pdfium: Engine, ask: PdfRequest): PdfPages {
  if (Atomics.load(ask.stop, 0) !== 0) return { status: 'refused', reason: 'the read was stopped' };
  const heap = pdfium.pdfium;
  const size = ask.bytes?.byteLength ?? 0;
  const source = heap.wasmExports.malloc(size);
  if (source === 0) {
    ask.bytes = undefined;
    return { status: 'refused', reason: "it does not fit the PDF reader's memory" };
  }
  if (ask.bytes !== undefined) heap.HEAPU8.set(new Uint8Array(ask.bytes), source);
  ask.bytes = undefined;
  const document = pdfium.FPDF_LoadMemDocument(source, size, '');
  try {
    if (document === 0) {
      return {
        status: 'refused',
        reason: pdfium.FPDF_GetLastError() === FPDF_ERR_PASSWORD ? 'it is encrypted' : 'PDFium cannot open it',
      };
    }
    return pagesOf(pdfium, document, ask);
  } finally {
    if (document !== 0) pdfium.FPDF_CloseDocument(document);
    heap.wasmExports.free(source);
  }
}

function pagesOf(pdfium: Engine, document: number, ask: PdfRequest): PdfPages {
  const { window, maxTextBytes } = ask;
  const pageCount = pdfium.FPDF_GetPageCount(document);
  if (pageCount <= 0) return { status: 'refused', reason: 'it has no pages' };
  if (window.first > pageCount) return { status: 'refused', reason: `page ${window.first} is past its last page, ${pageCount}` };
  const last = Math.min(pageCount, window.last ?? pageCount, window.first + PDF_WINDOW_PAGES - 1);
  const pages: PdfPage[] = [];
  const pictures: PdfPixels[] = [];
  let spent = 0;
  let next: number | null = last < pageCount ? last + 1 : null;
  for (let number = window.first; number <= last; number += 1) {
    if (Atomics.load(ask.stop, 0) !== 0) return { status: 'refused', reason: 'the read was stopped' };
    const left = maxTextBytes - spent - PDF_PAGE_FRAME;
    if (pages.length > 0 && left <= 0) {
      next = number;
      break;
    }
    const room = Math.max(left, 0);
    const page = pdfium.FPDF_LoadPage(document, number - 1);
    if (page === 0) {
      spent += PDF_PAGE_FRAME;
      pages.push({ page: number, text: '', state: 'unreadable' });
      continue;
    }
    try {
      const layer = pageText(pdfium, page, room);
      if (layer === null) {
        spent += PDF_PAGE_FRAME;
        pages.push({ page: number, text: '', state: 'unreadable' });
        continue;
      }
      const bytes = Buffer.byteLength(layer.text, 'utf8');
      const whole = layer.count <= room && bytes <= room;
      if (pages.length > 0 && !whole) {
        next = number;
        break;
      }
      spent += PDF_PAGE_FRAME + Math.min(bytes, room);
      if (!whole) {
        pages.push({ page: number, text: Buffer.from(layer.text, 'utf8').subarray(0, room).toString('utf8'), state: 'cut' });
        continue;
      }
      if (/\S/.test(layer.text)) {
        pages.push({ page: number, text: layer.text, state: 'text' });
        continue;
      }
      if (pictures.length >= PICTURES_MAX) {
        pages.push({ page: number, text: '', state: 'deferred' });
        continue;
      }
      const drawn = rendered(pdfium, page);
      if (drawn === null) {
        pages.push({ page: number, text: '', state: 'undrawn' });
        continue;
      }
      pictures.push({ page: number, ...drawn });
      pages.push({ page: number, text: '', state: 'shown' });
    } finally {
      pdfium.FPDF_ClosePage(page);
    }
  }
  return {
    status: 'read',
    pageCount,
    first: window.first,
    last: pages.at(-1)?.page ?? window.first,
    pages,
    pictures,
    next,
  };
}

function pageText(pdfium: Engine, page: number, room: number): { readonly count: number; readonly text: string } | null {
  const textPage = pdfium.FPDFText_LoadPage(page);
  if (textPage === 0) return null;
  try {
    const count = Math.max(pdfium.FPDFText_CountChars(textPage), 0);
    const taken = Math.min(count, room);
    if (taken === 0) return { count, text: '' };
    const buffer = pdfium.pdfium.wasmExports.malloc((taken + 1) * 2);
    if (buffer === 0) return null;
    try {
      pdfium.FPDFText_GetText(textPage, 0, taken, buffer);
      return { count, text: pdfium.pdfium.UTF16ToString(buffer).replace(/\r\n?/g, '\n') };
    } finally {
      pdfium.pdfium.wasmExports.free(buffer);
    }
  } finally {
    pdfium.FPDFText_ClosePage(textPage);
  }
}

function rendered(pdfium: Engine, page: number): { readonly width: number; readonly height: number; readonly rgba: Uint8Array } | null {
  const pointsWide = pdfium.FPDF_GetPageWidthF(page);
  const pointsHigh = pdfium.FPDF_GetPageHeightF(page);
  if (!(pointsWide > 0) || !(pointsHigh > 0)) return null;
  const scale = RENDER_LONG_SIDE / Math.max(pointsWide, pointsHigh);
  const width = Math.max(1, Math.round(pointsWide * scale));
  const height = Math.max(1, Math.round(pointsHigh * scale));
  const bitmap = pdfium.FPDFBitmap_Create(width, height, 1);
  if (bitmap === 0) return null;
  try {
    pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
    pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, FPDF_ANNOT);
    const stride = pdfium.FPDFBitmap_GetStride(bitmap);
    const start = pdfium.FPDFBitmap_GetBuffer(bitmap);
    const row = width * 4;
    const rgba = new Uint8Array(row * height);
    if (stride === row) rgba.set(pdfium.pdfium.HEAPU8.subarray(start, start + row * height));
    else
      for (let line = 0; line < height; line += 1)
        rgba.set(pdfium.pdfium.HEAPU8.subarray(start + line * stride, start + line * stride + row), line * row);
    const lanes = new Uint32Array(rgba.buffer);
    for (let index = 0; index < lanes.length; index += 1) {
      const bgra = lanes[index] as number;
      lanes[index] = (bgra & 0xff00ff00) | ((bgra & 0xff) << 16) | ((bgra >>> 16) & 0xff);
    }
    return { width, height, rgba };
  } finally {
    pdfium.FPDFBitmap_Destroy(bitmap);
  }
}
