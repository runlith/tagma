import { Duration, Effect, Layer, Schema, type Scope } from 'effect';
import { NO_CLAIMS, Tool, ToolFailed } from '@runlith/agent/tool';
import { foreignCause, runToolEffect, type ToolEdgeFailure } from './ToolEdge';
import type { Egress } from './world';
import type { WebToolOptions } from './webOptions';
import { DESCRIPTION_WEBFETCH } from './descriptions';
import { REFUSALS, refused } from './refusals';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '@runlith/agent/permissions';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const webfetchInputSchema = (ceilingMs: number) =>
  Schema.Struct({
    url: Schema.String.annotate({ description: 'The URL to fetch content from' }),
    format: Schema.optional(
      Schema.Literals(['text', 'markdown', 'html']).annotate({
        description: 'The format to return the content in (text, markdown, or html). Defaults to markdown.',
      }),
    ),
    timeout: Schema.optional(
      Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(ceilingMs / 1000)).annotate({
        description: `Optional timeout in seconds (max ${ceilingMs / 1000})`,
      }),
    ),
  });

type Params = ReturnType<typeof webfetchInputSchema>['Type'];

function isImageAttachment(mime: string): boolean {
  return mime.startsWith('image/');
}

const checkAborted = (signal: AbortSignal) => (signal.aborted ? Effect.fail(foreignCause(signal.reason)) : Effect.void);

function parseHttpUrl(input: string): Effect.Effect<URL, ToolFailed> {
  return Effect.suspend(() => {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return refused('call-shape', 'URL must be a valid absolute HTTP or HTTPS URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return refused('call-shape', 'URL must use http:// or https://');
    }
    return Effect.succeed(url);
  });
}

const MAX_REDIRECTS = 5;

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

const withoutWww = (host: string): string => (host.startsWith('www.') ? host.slice(4) : host);

const sameOrigin = (a: URL, b: URL): boolean =>
  a.origin === b.origin || (a.protocol === b.protocol && a.port === b.port && withoutWww(a.hostname) === withoutWww(b.hostname));

const discard = (response: Response) => Effect.promise(() => Promise.resolve(response.body?.cancel()).catch(() => undefined));

const quoted = (value: string): string => JSON.stringify(value.length > 120 ? `${value.slice(0, 120)}…` : value);

const reach = Effect.fn('WebfetchTool.reach')(function* (
  egress: Egress,
  approved: URL,
  init: { headers: Record<string, string>; signal: AbortSignal },
) {
  let target = approved;
  for (let hop = 0; ; hop += 1) {
    yield* checkAborted(init.signal);
    const response = yield* Effect.tryPromise({
      try: () => egress.fetch(target, { method: 'GET', headers: init.headers, signal: init.signal, redirect: 'manual' }),
      catch: foreignCause,
    });
    const location = REDIRECT_STATUS.has(response.status) ? response.headers.get('location') : null;
    if (location === null) {
      const landed = response.url === '' ? null : yield* originOf(response.url);
      if (landed !== null && !sameOrigin(landed, approved)) {
        yield* discard(response);
        return yield* refused('redirect-refused', crossed(target, landed));
      }
      return response;
    }
    yield* discard(response);
    if (hop >= MAX_REDIRECTS) {
      return yield* refused(
        'redirect-refused',
        `Too many redirects: ${approved.href} was still moving at ${target.href} after ${MAX_REDIRECTS} hops.`,
      );
    }
    let next: URL;
    try {
      next = new URL(location, target);
    } catch {
      return yield* refused('redirect-refused', `${target.href} redirected to an address that cannot be read: ${quoted(location)}`);
    }
    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      return yield* refused('redirect-refused', `${target.href} redirected to ${next.href}, which is not an http or https address.`);
    }
    if (!sameOrigin(next, approved)) return yield* refused('redirect-refused', crossed(target, next));
    target = next;
  }
});

const crossed = (from: URL, to: URL): string =>
  `${from.href} redirects to ${to.href}, which is a different origin than the one this call reached for. Call webfetch with that address so the destination it really reaches is the one that was allowed.`;

const originOf = (href: string): Effect.Effect<URL | null> =>
  Effect.sync(() => {
    try {
      return new URL(href);
    } catch {
      return null;
    }
  });

async function readLimitedBody(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) {
    signal.throwIfAborted();
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) {
        complete = true;
        break;
      }
      byteLength += value.byteLength;
      if (byteLength > limit) {
        throw refused('too-large', 'Response too large (exceeds 5MB limit)');
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', abort);
    if (!complete) await reader.cancel('Response body read did not complete.').catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function extractTextFromHtml(html: string): Promise<string> {
  const { Parser } = await import('htmlparser2');
  let text = '';
  let skipDepth = 0;
  const parser = new Parser({
    onopentag(name) {
      if (skipDepth > 0 || ['script', 'style', 'noscript', 'iframe', 'object', 'embed'].includes(name)) {
        skipDepth++;
      }
    },
    ontext(input) {
      if (skipDepth === 0) text += input;
    },
    onclosetag() {
      if (skipDepth > 0) skipDepth--;
    },
  });
  parser.write(html);
  parser.end();
  return text.trim();
}

async function convertHtmlToMarkdown(html: string): Promise<string> {
  const { default: TurndownService } = await import('turndown');
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });
  turndownService.remove(['script', 'style', 'meta', 'link']);
  return turndownService.turndown(html);
}

const stockService = (() => {
  let opened: Promise<{ turndown(html: string): string }> | undefined;
  return () =>
    (opened ??= import('turndown').then(({ default: TurndownService }) => {
      const service = new TurndownService();
      service.remove(['style', 'script', 'noscript', 'iframe']);
      return service;
    }));
})();

export async function convertHtmlToStockMarkdown(html: string): Promise<string> {
  return (await stockService()).turndown(html);
}

function acceptHeaderFor(format: 'text' | 'markdown' | 'html'): string {
  switch (format) {
    case 'markdown':
      return 'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1';
    case 'text':
      return 'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1';
    case 'html':
      return 'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1';
  }
}

const webfetchEffect = Effect.fnUntraced(function* (
  egress: Egress,
  params: Params,
  ctx: Tool.ToolCallOptions,
): Effect.fn.Return<string | Tool.ToolAnswer, ToolEdgeFailure, Scope.Scope> {
  const format = params.format ?? 'markdown';
  const timeout = Math.min((params.timeout ?? egress.fetchDefaultMs / 1000) * 1000, egress.fetchCeilingMs);
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    Accept: acceptHeaderFor(format),
    'Accept-Language': 'en-US,en;q=0.9',
  };
  const controller = new AbortController();
  let timedOut = false;
  yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));
  yield* Effect.forkScoped(
    Effect.sleep(Duration.millis(timeout)).pipe(
      Effect.andThen(
        Effect.sync(() => {
          if (controller.signal.aborted) return;
          timedOut = true;
          controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
        }),
      ),
    ),
  );
  const signal = controller.signal;
  let response: Response | null = null;

  const attempt = Effect.gen(function* () {
    const target = yield* parseHttpUrl(params.url);
    yield* checkAborted(signal);
    response = yield* reach(egress, target, { headers, signal });
    yield* checkAborted(signal);
    const settled = response;
    if (!settled) return yield* new ToolFailed({ reason: 'Request produced no response' });

    if (!settled.ok) {
      return yield* refused('http-status', `HTTP ${settled.status} ${settled.statusText} for ${target.href}`);
    }
    const contentLength = settled.headers.get('content-length');
    if (contentLength) {
      const declaredLength = Number.parseInt(contentLength, 10);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_SIZE) {
        yield* Effect.promise(() => Promise.resolve(settled.body?.cancel()).catch(() => undefined));
        return yield* refused('too-large', 'Response too large (exceeds 5MB limit)');
      }
    }
    const bytes = yield* Effect.tryPromise({
      try: () => readLimitedBody(settled, MAX_RESPONSE_SIZE, signal),
      catch: (cause) => (cause instanceof ToolFailed ? cause : foreignCause(cause)),
    });
    const contentType = settled.headers.get('content-type') ?? '';
    const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';

    if (isImageAttachment(mime)) {
      return new Tool.ToolAnswer(
        `Image fetched — content-type ${mime}, ${bytes.byteLength} bytes.`,
        {
          form: 'none',
          title: params.url,
          opens: true,
          details: [
            { label: 'type', value: mime },
            { label: 'bytes', value: String(bytes.byteLength) },
          ],
        },
        { media: [{ bytes, mediaType: mime, label: settled.url || target.href }] },
      );
    }
    const content = new TextDecoder().decode(bytes);
    const landed = settled.url || target.href;
    const head = {
      title: params.url,
      subtitle: landed === params.url ? undefined : `→ ${landed}`,
    };
    switch (format) {
      case 'markdown': {
        const text = contentType.includes('text/html') ? yield* Effect.promise(() => convertHtmlToMarkdown(content)) : content;
        return new Tool.ToolAnswer(text, { ...head, form: 'markdown', text });
      }
      case 'text': {
        const text = contentType.includes('text/html') ? yield* Effect.promise(() => extractTextFromHtml(content)) : content;
        return new Tool.ToolAnswer(text, { ...head, form: 'text', text });
      }
      case 'html':
        return new Tool.ToolAnswer(content, { ...head, form: 'code', language: 'html', text: content });
    }
  });

  return yield* attempt.pipe(
    Effect.catch((failure) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Promise.resolve(response?.body?.cancel(failure)).catch(() => undefined));
        if (timedOut) return yield* new ToolFailed({ reason: 'Request timed out' });
        return yield* Effect.fail(failure);
      }),
    ),
  );
}, Effect.scoped);

export function createWebfetchTool(options: WebToolOptions): Tool {
  const { egress } = options;
  const webfetchTool = Tool.make({
    approval: ASKS_IN_REVIEW,
    description: DESCRIPTION_WEBFETCH,
    refusals: REFUSALS,
    parameters: webfetchInputSchema(egress.fetchCeilingMs),
    display: { streamFields: ['url'], project: (input) => ({ form: 'none', title: input.url }) },
    execute: (params: Params, call) => runToolEffect('webfetch', Layer.empty, webfetchEffect(egress, params, call)),
    subjects: (input) => [{ kind: 'network', value: input.url }],
    claims: NO_CLAIMS,
  });
  return webfetchTool;
}
