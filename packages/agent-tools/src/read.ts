import * as path from 'node:path';
import { Tool, ToolFailed } from '@runlith/agent/tool';
import { THREAD_ATTACHMENT_SOURCE_MAX_BYTES } from '@runlith/agent/transcript/attachments';
import { PAGE_CURSOR, offsetPage, pageRows, readOffsetCursor, resumeOffset, type PageQuestion } from '@runlith/paging';
import { BINARY_PROBE, looksBinary } from '@runlith/files/content';
import { displayLanguage } from '@runlith/utils/codeLanguage';
import { Effect, FileSystem, Option, Schema, Stream } from 'effect';
import { DESCRIPTION_READ } from './descriptions';
import { displayCount, displayPath, pageWindow } from './display';
import { orAbsent } from './namespace';
import { missingPath } from './missingPath';
import { REFUSALS, refused } from './refusals';
import { PDF_MAX_BYTES, PDF_WINDOW_PAGES, readPdf, type PdfWindow } from './pdf';
import { runToolEffect, unboundTool } from './ToolEdge';
import { LISTING, ceilingOf } from './pageFamilies';
import type { PreparedPath, ToolFactoryOptions } from './workspace';
import { admitPreparedPath, pathClaims, pathPreparation, resolveToolOptions } from './workspace/runtime';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '@runlith/agent/permissions';

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`;
const MAX_BYTES = 50 * 1024;
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`;
const SAMPLE_BYTES = BINARY_PROBE;
const DIRECTORY_CEILING = ceilingOf(LISTING);

const PICTURE_SIGNATURES: readonly { readonly mediaType: string; readonly at: number; readonly bytes: readonly number[] }[] = [
  { mediaType: 'image/png', at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mediaType: 'image/jpeg', at: 0, bytes: [0xff, 0xd8, 0xff] },
  { mediaType: 'image/gif', at: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  { mediaType: 'image/webp', at: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
];

function pictureType(sample: Uint8Array): string | undefined {
  const riff = sample[0] === 0x52 && sample[1] === 0x49 && sample[2] === 0x46 && sample[3] === 0x46;
  return PICTURE_SIGNATURES.find(
    (signature) => (signature.at === 0 || riff) && signature.bytes.every((byte, index) => sample[signature.at + index] === byte),
  )?.mediaType;
}

const REFUSED = {
  'cursor-stale': {
    code: 'cursor-stale',
    reason: 'this cursor belongs to another listing; repeat the call that printed it with only the cursor added, or call with no cursor.',
  },
  moved: { code: 'cursor-stale', reason: 'the directory changed since that page was answered; call again with no cursor.' },
  'bad-cursor': {
    code: 'bad-cursor',
    reason: 'this is not a cursor read printed; hand back the cursor a cut listing printed, unchanged, or call with no cursor.',
  },
} as const;

const refuseCursor = (cursor: keyof typeof REFUSED): ToolFailed => refused(REFUSED[cursor].code, REFUSED[cursor].reason);

const readInputSchema = Schema.Struct({
  path: Schema.String.annotate({ description: 'The absolute path to the file or directory to read' }),
  offset: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
      description: 'The line number to start reading from (1-indexed); files only — a directory continues with cursor',
    }),
  ),
  limit: Schema.optional(
    Schema.Int.check(Schema.isGreaterThan(0)).annotate({
      description: `The maximum number of lines to read (defaults to 2000); a directory answers ${pageRows(undefined, LISTING, DIRECTORY_CEILING)} entries per page, ${DIRECTORY_CEILING} at most, and continues with cursor`,
    }),
  ),
  cursor: PAGE_CURSOR,
  pages: Schema.optional(
    Schema.String.check(Schema.isPattern(/^\d+(-\d+)?$/u)).annotate({
      description: 'PDF only: one page ("7") or a span ("3-9"), 1-based; omit to start at page 1',
    }),
  ),
});

type Params = typeof readInputSchema.Type;

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PDF_HEADER_REACH = 1024;

function isPdf(sample: Uint8Array): boolean {
  const reach = Math.min(sample.length, PDF_HEADER_REACH) - PDF_SIGNATURE.length;
  for (let at = 0; at <= reach; at += 1) {
    if (PDF_SIGNATURE.every((byte, index) => sample[at + index] === byte)) return true;
  }
  return false;
}

const PDF_PAGE_NOTES = {
  shown: '(no text layer: the page is shown as a picture)',
  undrawn: '(no text layer, and the page could not be drawn)',
  unreadable: '(PDFium cannot read this page)',
} as const;

function pdfWindow(pages: string | undefined): PdfWindow {
  if (pages === undefined) return { first: 1, last: undefined };
  const [first, last] = pages.split('-').map(Number);
  return { first: first ?? 1, last: last ?? first };
}

const pdfAnswer = Effect.fn('ReadTool.pdf')(function* (
  resolved: ReturnType<typeof resolveToolOptions>,
  filepath: string,
  size: number,
  pages: string | undefined,
) {
  const window = pdfWindow(pages);
  if (window.first < 1 || (window.last !== undefined && window.last < window.first)) {
    return yield* refused('call-shape', `pages "${pages}" names no page: pages count from 1, and a span runs forward.`);
  }
  const relative = displayPath(resolved.cwd, filepath);
  const unread = (reason: string) => {
    const said = `The PDF is not read: ${reason}.`;
    return new Tool.ToolAnswer(said, { form: 'text', title: relative, text: said });
  };
  if (size > PDF_MAX_BYTES) return unread(`it is ${size} bytes, past the ${PDF_MAX_BYTES / (1024 * 1024)} MB a PDF may be`);
  const fs = yield* FileSystem.FileSystem;
  const bytes = yield* fs.readFile(filepath);
  const frame = 2 * Buffer.byteLength(filepath, 'utf8') + 512;
  const reading = yield* Effect.tryPromise({
    try: (signal) => readPdf(bytes, window, MAX_BYTES - frame, signal),
    catch: (cause) =>
      new ToolFailed({ reason: `PDFium could not read ${filepath}: ${cause instanceof Error ? cause.message : String(cause)}` }),
  });
  if (reading.status === 'refused') return unread(reading.reason);
  const body = reading.pages
    .map(({ page, text, state }) => {
      const said =
        state === 'text'
          ? text
          : state === 'cut'
            ? `${text}\n(the page continues past the ${MAX_BYTES_LABEL} of text one read answers; the rest of it is not shown)`
            : state === 'deferred'
              ? `(no text layer: read it as a picture with pages="${page}")`
              : PDF_PAGE_NOTES[state];
      return `--- page ${page} ---\n${said}`;
    })
    .join('\n');
  const span = `${reading.first}-${reading.last}`;
  const cut = reading.pages.find((page) => page.state === 'cut');
  const footer = [
    ...(reading.next === null
      ? []
      : [
          `(Showing pages ${span} of ${reading.pageCount}. Use pages="${reading.next}-${Math.min(reading.pageCount, reading.next + PDF_WINDOW_PAGES - 1)}" to continue.)`,
        ]),
    ...(cut === undefined ? [] : [`(Page ${cut.page} was cut to the first ${MAX_BYTES_LABEL} of its text.)`]),
  ];
  const output = footer.length === 0 ? body : [body, '', ...footer].join('\n');
  return new Tool.ToolAnswer(
    output,
    {
      form: 'text',
      title: relative,
      text: body,
      facts: [{ label: 'pages', value: `${span} of ${reading.pageCount}` }],
      opens: reading.pictures.length > 0 ? true : undefined,
    },
    {
      media: reading.pictures.map((picture) => ({
        bytes: picture.png,
        mediaType: 'image/png',
        label: `${relative} page ${picture.page}`,
      })),
      shown: [{ path: filepath, as: 'read' }],
    },
  );
});

const miss = Effect.fn('ReadTool.miss')(function* (cwd: string, filepath: string, asked: string) {
  const text = yield* missingPath(cwd, filepath, asked, 'File not found');
  return new Tool.ToolAnswer(
    text,
    {
      form: 'text',
      title: displayPath(cwd, filepath),
      text,
      facts: [{ label: 'not found', value: path.basename(filepath) }],
    },
    { refusal: { code: 'not-found', reason: text } },
  );
});

const list = Effect.fn('ReadTool.list')(function* (filepath: string) {
  const fs = yield* FileSystem.FileSystem;
  const entries = yield* fs.readDirectory(filepath);
  return yield* Effect.forEach(
    entries,
    (entry) => Effect.map(orAbsent(fs.stat(path.join(filepath, entry))), (info) => (info?.type === 'Directory' ? `${entry}/` : entry)),
    { concurrency: 'unbounded' },
  );
});

const readSample = Effect.fn('ReadTool.readSample')(function* (filepath: string, fileSize: number, sampleSize: number) {
  if (fileSize === 0) return new Uint8Array();
  const fs = yield* FileSystem.FileSystem;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const file = yield* fs.open(filepath, { flag: 'r' });
      return Option.getOrElse(yield* file.readAlloc(Math.min(sampleSize, fileSize)), () => new Uint8Array());
    }),
  );
});

const lines = Effect.fn('ReadTool.lines')(function* (filepath: string, opts: { limit: number; offset: number }) {
  const fs = yield* FileSystem.FileSystem;
  const start = opts.offset - 1;
  const raw: string[] = [];
  const flags = { bytes: 0, count: 0, cut: false, more: false };
  const decoder = new TextDecoder('utf-8');
  let buffered = '';
  let stopped = false;

  const processLine = (text: string): boolean => {
    flags.count += 1;
    if (flags.count <= start) return true;
    if (raw.length >= opts.limit) {
      flags.more = true;
      return false;
    }
    const line = text.length > MAX_LINE_LENGTH ? text.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : text;
    const size = Buffer.byteLength(line, 'utf-8') + (raw.length > 0 ? 1 : 0);
    if (flags.bytes + size <= MAX_BYTES) {
      raw.push(line);
      flags.bytes += size;
      return true;
    }
    flags.cut = true;
    flags.more = true;
    return false;
  };

  yield* fs.stream(filepath).pipe(
    Stream.runForEachWhile((bytes) =>
      Effect.sync(() => {
        buffered += decoder.decode(bytes, { stream: true });
        let newlineIndex = buffered.indexOf('\n');
        while (newlineIndex !== -1) {
          const text = buffered.slice(0, newlineIndex);
          buffered = buffered.slice(newlineIndex + 1);
          if (!processLine(text)) {
            buffered = '';
            stopped = true;
            return false;
          }
          newlineIndex = buffered.indexOf('\n');
        }
        return true;
      }),
    ),
  );
  if (!stopped) {
    buffered += decoder.decode();
    if (buffered.length > 0) processLine(buffered);
  }
  return {
    raw,
    count: flags.count,
    cut: flags.cut,
    more: flags.more,
    offset: opts.offset,
    total: stopped ? undefined : flags.count,
  };
});

const BINARY_EXTENSIONS = new Set([
  '.zip',
  '.tar',
  '.gz',
  '.exe',
  '.dll',
  '.so',
  '.class',
  '.jar',
  '.war',
  '.7z',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.bin',
  '.dat',
  '.obj',
  '.o',
  '.a',
  '.lib',
  '.wasm',
  '.pyc',
  '.pyo',
]);

function isBinaryFile(filepath: string, sample: Uint8Array): boolean {
  const dot = filepath.lastIndexOf('.');
  const ext = dot >= 0 ? filepath.slice(dot).toLowerCase() : '';
  return BINARY_EXTENSIONS.has(ext) || looksBinary(sample);
}

const run = Effect.fn('ReadTool.execute')(function* (
  resolved: ReturnType<typeof resolveToolOptions>,
  params: Params,
  prepared: PreparedPath | undefined,
) {
  const fs = yield* FileSystem.FileSystem;
  const filepath = yield* admitPreparedPath(resolved, prepared, { allowMissing: true });
  const info = yield* orAbsent(fs.stat(filepath));

  if (!info) return yield* miss(resolved.cwd, filepath, params.path);

  if (info.type === 'Directory') {
    if (params.pages !== undefined) {
      return yield* refused('call-shape', 'pages windows a PDF; a directory pages with cursor: call again with no pages.');
    }
    if (params.offset !== undefined) {
      return yield* refused('call-shape', 'read pages a directory with cursor, not offset: call again with no offset to start over.');
    }
    const question: PageQuestion = { operation: 'read', selection: { path: filepath }, order: LISTING.order };
    const continued = params.cursor === undefined ? undefined : readOffsetCursor(params.cursor, question);
    if (continued !== undefined && 'refused' in continued) return yield* refuseCursor(continued.refused);
    const items = yield* list(filepath);
    items.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const at = continued === undefined ? 0 : resumeOffset(items, String, continued);
    if (at === null) return yield* refuseCursor('moved');
    const cut = offsetPage({ rows: items, at, asked: pageRows(params.limit, LISTING, DIRECTORY_CEILING), question, keyOf: String });
    const window = `${pageWindow(cut.from, cut.rows.length, items.length)} ${items.length === 1 ? 'entry' : 'entries'}`;
    const output = [...cut.rows, `(${window}${cut.next === null ? '' : ` · cursor="${cut.next}"`})`].join('\n');
    return new Tool.ToolAnswer(output, {
      form: 'list',
      title: displayPath(resolved.cwd, filepath),
      items: cut.rows.map((entry) => ({ label: entry })),
      total: items.length,
      facts: [displayCount('entries', items.length)],
    });
  }

  const sample = yield* readSample(filepath, Number(info.size), SAMPLE_BYTES);

  if (isPdf(sample)) {
    if (params.offset !== undefined || params.limit !== undefined || params.cursor !== undefined) {
      return yield* refused('call-shape', 'a PDF windows with pages, not offset, limit or cursor: call again with pages.');
    }
    return yield* pdfAnswer(resolved, filepath, Number(info.size), params.pages);
  }

  if (params.pages !== undefined) {
    return yield* refused('call-shape', 'pages windows a PDF; this file windows with offset and limit: call again with no pages.');
  }

  if (params.cursor !== undefined) {
    return yield* refused('call-shape', 'read windows a file with offset, not cursor: call again with no cursor.');
  }

  if (Number(info.size) > 200 * 1024 * 1024) {
    return yield* refused(
      'too-large',
      `File is too large to read directly (${Number(info.size)} bytes). Use grep/glob to target what you need.`,
    );
  }

  const picture = pictureType(sample);
  if (picture !== undefined) {
    const relative = displayPath(resolved.cwd, filepath);
    const facts = [{ label: 'image', value: picture.slice('image/'.length) }];
    if (Number(info.size) > THREAD_ATTACHMENT_SOURCE_MAX_BYTES) {
      const said = `Picture ${relative} is not shown: it is ${Number(info.size)} bytes, past the ${THREAD_ATTACHMENT_SOURCE_MAX_BYTES / (1024 * 1024)} MB a picture may be.`;
      return new Tool.ToolAnswer(said, { form: 'text', title: relative, text: said, facts });
    }
    const bytes = yield* fs.readFile(filepath);
    return new Tool.ToolAnswer(
      `(${picture})`,
      { form: 'none', title: relative, opens: true, facts },
      { media: [{ bytes, mediaType: picture, label: relative }], shown: [{ path: filepath, as: 'read' }] },
    );
  }

  if (isBinaryFile(filepath, sample)) {
    return yield* refused('not-text', `Cannot read binary file: ${filepath}`);
  }

  const file = yield* lines(filepath, {
    limit: params.limit ?? DEFAULT_READ_LIMIT,
    offset: params.offset || 1,
  });
  const last = file.offset + file.raw.length - 1;
  const next = last + 1;
  const windowed = file.cut || file.more;
  if (!windowed && file.total === undefined) {
    return yield* new ToolFailed({ reason: 'Read stopped without a continuation or an exact total.' });
  }
  const numbered = file.raw.map((line, i) => `${i + file.offset}\t${line}`).join('\n');
  const output = file.cut
    ? `${numbered}\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${file.offset}-${last}. Use offset=${next} to continue.)`
    : file.more
      ? `${numbered}\n\n(Showing lines ${file.offset}-${last}. Use offset=${next} to continue.)`
      : file.raw.length > 0
        ? numbered
        : file.total === 0
          ? '(The file is empty.)'
          : `(offset=${file.offset} is past the end: the file has ${file.total} lines.)`;
  const relative = displayPath(resolved.cwd, filepath);
  const language = displayLanguage(filepath);
  return new Tool.ToolAnswer(
    output,
    {
      form: 'code',
      title: relative,
      text: file.raw.join('\n'),
      path: relative,
      language: language || undefined,
      firstLine: file.offset,
      facts: [
        windowed
          ? {
              label: 'lines',
              value: file.total === undefined ? `${file.offset}–${last}` : `${file.offset}–${last} of ${file.total}`,
            }
          : displayCount('lines', file.total ?? file.count),
      ],
    },
    { shown: [{ path: filepath, as: 'read' }] },
  );
});

export function createReadTool(options: ToolFactoryOptions): Tool {
  const resolved = resolveToolOptions(options);
  const { cwd, world } = resolved;
  const readTool = Tool.make({
    approval: ASKS_NEVER,
    description: DESCRIPTION_READ,
    refusals: REFUSALS,
    parameters: readInputSchema,
    display: {
      streamFields: ['path'],
      project: (input) => ({ form: 'none', title: input.path === undefined ? undefined : displayPath(cwd, input.path) }),
    },
    prepare: (input) => pathPreparation(resolved, input.path, 'read'),
    claims: (input) => pathClaims(resolved, [input.path], 'read'),
    execute: (params, call) =>
      world.files === undefined
        ? unboundTool('read', 'filesystem')
        : runToolEffect('read', world.files, run(resolved, params, call.prepared), call),
  });
  return readTool;
}
