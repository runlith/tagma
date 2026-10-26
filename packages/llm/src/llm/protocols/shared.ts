import { Buffer } from 'node:buffer';
import { Effect, Result, Schema } from 'effect';
import { Headers, HttpClientRequest } from 'effect/http';
import { redactSecrets } from '../../redact';
import type { StreamRefusal } from '../route/refusal';
import type { ContentPart, LLMRequest, MediaPart, TextPart, ToolResultPart } from '../schema/messages';
import {
  InvalidProviderOutputReason,
  InvalidRequestReason,
  LLMError,
  ProviderInternalReason,
  StreamStalledReason,
  UnknownProviderReason,
  type WireAttempt,
  type WireCause,
  WIRE_CAUSE_DEPTH,
  WIRE_EXCERPT_LIMIT,
  type WireFailureFamily,
} from '../schema/errors';
import type { ToolFileContent } from '../schema/tool-content';
import { headerNames, namedHeaders } from '../utils/headers';

export const Json = Schema.fromJsonString(Schema.Unknown);
export const decodeJson = Schema.decodeUnknownSync(Json);
export const encodeJson = Schema.encodeSync(Json);
const isJson = Schema.is(Schema.Json);
export const JsonObject = Schema.Record(Schema.String, Schema.Unknown);
export const optionalArray = <const S extends Schema.Top>(schema: S) => Schema.optional(Schema.Array(schema));
export const optionalNull = <const S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema));

export interface ToolAccumulator {
  readonly id: string;
  readonly name: string;
  readonly input: string[];
}

export const totalTokens = (inputTokens: number | undefined, outputTokens: number | undefined, total: number | undefined) => {
  if (total !== undefined) return total;
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return (inputTokens ?? 0) + (outputTokens ?? 0);
};

export const subtractTokens = (total: number | undefined, subtrahend: number | undefined): number | undefined => {
  if (total === undefined) return undefined;
  if (subtrahend === undefined) return total;
  return Math.max(0, total - subtrahend);
};

export const sumTokens = (...values: ReadonlyArray<number | undefined>): number | undefined => {
  if (values.every((value) => value === undefined)) return undefined;
  return values.reduce((acc: number, value) => acc + (value ?? 0), 0);
};

export interface WireBreak extends WireAttempt {
  readonly message: string;
  readonly family: WireFailureFamily;
  readonly module?: string;
  readonly method?: string;
  readonly route?: string;
  readonly excerpt?: string;
  readonly secrets?: Iterable<string>;
}

const bounded = (text: string) => (text.length <= WIRE_EXCERPT_LIMIT ? text : `${text.slice(0, WIRE_EXCERPT_LIMIT)}…`);

const jsonText = (value: unknown) => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

const causeTag = (error: Error) => {
  const tag = '_tag' in error ? (error as { readonly _tag?: unknown })._tag : undefined;
  if (typeof tag === 'string' && tag.length > 0) return tag;
  return error.name.length > 0 ? error.name : 'unknown';
};

const unwrapped = (error: Error) => {
  let current = error;
  for (let depth = 0; depth < WIRE_CAUSE_DEPTH; depth += 1) {
    const reason = 'reason' in current ? (current as { readonly reason?: unknown }).reason : undefined;
    if (!(reason instanceof Error) || reason.message !== current.message) return current;
    current = reason;
  }
  return current;
};

export const causeChain = (value: unknown, secrets: Iterable<string> = []): ReadonlyArray<WireCause> => {
  const links: WireCause[] = [];
  let current: unknown = value;
  for (let depth = 0; depth < WIRE_CAUSE_DEPTH; depth += 1) {
    if (current === undefined || current === null) break;
    if (!(current instanceof Error)) {
      links.push({ tag: 'unknown', message: bounded(redactSecrets(jsonText(current), secrets)) });
      break;
    }
    const error = unwrapped(current);
    const code = 'code' in error && typeof error.code === 'string' && error.code.length > 0 ? error.code : undefined;
    links.push({
      tag: bounded(redactSecrets(causeTag(error), secrets)),
      message: bounded(redactSecrets(error.message, secrets)),
      code: code === undefined ? undefined : bounded(redactSecrets(code, secrets)),
    });
    current = error.cause;
  }
  return links;
};

export const causeCode = (value: unknown): string | undefined => {
  let current: unknown = value;
  for (let depth = 0; depth < WIRE_CAUSE_DEPTH; depth += 1) {
    if (!(current instanceof Error)) return undefined;
    const error = unwrapped(current);
    const code = 'code' in error ? (error as { readonly code?: unknown }).code : undefined;
    if (typeof code === 'string' && code.length > 0) return code;
    current = error.cause;
  }
  return undefined;
};

const readingOf = (input: WireAttempt) =>
  [
    input.status === undefined ? undefined : `HTTP ${input.status}`,
    input.upstreamRequestId,
    input.bytesRead === undefined ? undefined : `${input.bytesRead} bytes`,
    input.lastEvent === undefined
      ? undefined
      : `${input.lastEvent.count} events${input.lastEvent.type === undefined ? '' : `, last ${input.lastEvent.type}`}`,
    input.elapsedMs === undefined ? undefined : `${input.elapsedMs} ms`,
  ].filter((part): part is string => part !== undefined && part !== '');

const rendered = (input: WireBreak) => {
  const reading = readingOf(input);
  return reading.length === 0 ? input.message : `${input.message} (${[input.family, ...reading].join(' · ')})`;
};

export const failureOf = (cause: unknown, input: WireBreak) => {
  const redact = (text: string) => redactSecrets(text, input.secrets ?? []);
  const chain = causeChain(cause, input.secrets ?? []);
  return new LLMError({
    module: input.module ?? 'ProviderShared',
    method: input.method ?? 'stream',
    reason: new InvalidProviderOutputReason({
      message: rendered(input),
      family: input.family,
      route: input.route,
      excerpt: input.excerpt === undefined ? undefined : bounded(redact(input.excerpt)),
      status: input.status,
      upstreamRequestId: input.upstreamRequestId,
      attempt: input.attempt,
      bytesRead: input.bytesRead,
      elapsedMs: input.elapsedMs,
      lastEvent: input.lastEvent,
      cause: chain.length === 0 ? undefined : chain,
    }),
  });
};

const filled = <T extends WireAttempt>(reason: T, facts: WireAttempt): T & WireAttempt => ({
  ...reason,
  status: reason.status ?? facts.status,
  upstreamRequestId: reason.upstreamRequestId ?? facts.upstreamRequestId,
  attempt: reason.attempt ?? facts.attempt,
  bytesRead: reason.bytesRead ?? facts.bytesRead,
  elapsedMs: reason.elapsedMs ?? facts.elapsedMs,
  lastEvent: reason.lastEvent ?? facts.lastEvent,
});

export const withAttempt = (error: LLMError, facts: WireAttempt, secrets: Iterable<string> = []): LLMError => {
  const reason = error.reason;
  const safe = (text: string) => bounded(redactSecrets(text, secrets));
  const rebuilt = (): LLMError['reason'] => {
    switch (reason._tag) {
      case 'InvalidProviderOutput': {
        const complete = {
          ...filled(reason, facts),
          message: safe(reason.message),
          excerpt: reason.excerpt === undefined ? undefined : safe(reason.excerpt),
          cause: reason.cause?.map((link) => ({
            tag: safe(link.tag),
            message: safe(link.message),
            code: link.code === undefined ? undefined : safe(link.code),
          })),
        };
        return new InvalidProviderOutputReason(
          reason.attempt === undefined ? { ...complete, message: rendered({ ...complete, family: reason.family }) } : complete,
        );
      }
      case 'ProviderInternal':
        return new ProviderInternalReason({ ...filled(reason, facts), message: safe(reason.message) });
      case 'UnknownProvider':
        return new UnknownProviderReason({ ...filled(reason, facts), message: safe(reason.message) });
      case 'InvalidRequest':
        return new InvalidRequestReason({ ...filled(reason, facts), message: safe(reason.message) });
      case 'StreamStalled':
        return new StreamStalledReason(filled(reason, facts));
      default:
        return reason;
    }
  };
  const next = rebuilt();
  return next === reason ? error : new LLMError({ module: error.module, method: error.method, reason: next });
};

export interface RefusalEvidence {
  readonly eventType: string | undefined;
  readonly keys: ReadonlyArray<string>;
  readonly payloadKeys?: ReadonlyArray<string>;
}

const refusalSentence = (refusal: StreamRefusal) => {
  if (refusal.message && refusal.code) return `${refusal.code}: ${refusal.message}`;
  return refusal.message || refusal.code || '';
};

export const providerStreamFailure = (input: {
  readonly module: string;
  readonly refusal: StreamRefusal;
  readonly evidence: RefusalEvidence;
  readonly unrecognized?: boolean;
  readonly retryable?: boolean | undefined;
  readonly contextOverflow?: boolean | undefined;
  readonly modelStarted?: boolean | undefined;
}) => {
  const message = redactSecrets(refusalSentence(input.refusal).trim());
  if (message === '') {
    return failureOf(undefined, {
      module: input.module,
      message: input.unrecognized
        ? 'The provider ended the stream with an unrecognized error payload; its cause could not be read'
        : 'The provider ended the stream with an error naming neither a code nor a message',
      family: input.unrecognized ? 'invalid-output' : 'blank-error',
      excerpt: encodeJson({
        kind: input.unrecognized ? 'unrecognized-error' : 'blank-error',
        eventType: input.evidence.eventType ?? null,
        keys: [...input.evidence.keys].sort(),
        payloadKeys: input.evidence.payloadKeys?.length ? [...input.evidence.payloadKeys].sort() : undefined,
      }),
    });
  }
  return new LLMError({
    module: input.module,
    method: 'stream',
    reason: input.contextOverflow
      ? new InvalidRequestReason({ message, classification: 'context-overflow' })
      : input.retryable
        ? new ProviderInternalReason({ message, modelStarted: input.modelStarted })
        : new UnknownProviderReason({ message, modelStarted: input.modelStarted }),
  });
};

export const parseJson = (route: string, input: string, message: string) =>
  Effect.try({
    try: () => decodeJson(input),
    catch: (cause) => failureOf(cause, { route, message, family: 'invalid-output', excerpt: input }),
  });

export const joinText = (parts: ReadonlyArray<{ readonly text: string }>) => parts.map((part) => part.text).join('\n');

const escapeSystemUpdateText = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export const wrapSystemUpdate = (parts: ReadonlyArray<{ readonly text: string }>) =>
  `<system-update>\n${escapeSystemUpdateText(joinText(parts))}\n</system-update>`;

export const systemUpdateText = Effect.fn('ProviderShared.systemUpdateText')(function* (
  route: string,
  message: LLMRequest['messages'][number],
) {
  const content: TextPart[] = [];
  for (const part of message.content) {
    if (!supportsContent(part, ['text'])) return yield* unsupportedContent(route, 'system', ['text']);
    content.push(part);
  }
  return content;
});

export const wrappedSystemUpdate = Effect.fn('ProviderShared.wrappedSystemUpdate')(function* (
  route: string,
  message: LLMRequest['messages'][number],
) {
  const content = yield* systemUpdateText(route, message);
  return { type: 'text' as const, text: wrapSystemUpdate(content), cache: content.at(-1)?.cache };
});

const decodeJsonResult = Schema.decodeUnknownResult(Json);

export type ToolInput = { readonly input: unknown; readonly unparsed?: string };

export const toolInput = (raw: string): ToolInput => {
  const decoded = decodeJsonResult(raw || '{}');
  return Result.isSuccess(decoded) ? { input: decoded.success } : { input: {}, unparsed: raw };
};

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
export const AUDIO_MIMES = ['audio/wav', 'audio/mp3', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac'] as const;
export const MEDIA_MIMES = [...IMAGE_MIMES, ...VIDEO_MIMES, ...AUDIO_MIMES] as const;
export const MAX_MEDIA_ENCODED_BYTES = 28 * 1024 * 1024;
export const MAX_MEDIA_DECODED_BYTES = 20 * 1024 * 1024;

export interface ValidatedMedia {
  readonly mime: string;
  readonly base64: string;
  readonly dataUrl: string;
  readonly bytes: Uint8Array;
}

export const validateMedia = Effect.fn('ProviderShared.validateMedia')(function* (
  route: string,
  part: MediaPart,
  supportedMimes: ReadonlySet<string>,
) {
  const mime = part.mediaType.toLowerCase();
  if (!supportedMimes.has(mime)) return yield* invalidRequest(`${route} does not support media type ${part.mediaType}`);

  let base64: string;
  if (typeof part.data !== 'string') {
    if (part.data.byteLength > MAX_MEDIA_DECODED_BYTES)
      return yield* invalidRequest(`${route} media exceeds the ${MAX_MEDIA_DECODED_BYTES} byte decoded limit`);
    base64 = Buffer.from(part.data).toString('base64');
  } else if (part.data.startsWith('data:')) {
    const comma = part.data.indexOf(',');
    const header = comma < 0 ? '' : part.data.slice(5, comma);
    const encodingAt = header.indexOf(';');
    if (comma < 0 || encodingAt <= 0 || header.slice(encodingAt) !== ';base64')
      return yield* invalidRequest(`${route} media data URL must contain valid base64`);
    const dataMime = header.slice(0, encodingAt);
    if (dataMime.toLowerCase() !== mime)
      return yield* invalidRequest(`${route} media type ${part.mediaType} does not match data URL type ${dataMime}`);
    base64 = part.data.slice(comma + 1);
  } else {
    base64 = part.data;
  }

  if (Buffer.byteLength(base64, 'utf8') > MAX_MEDIA_ENCODED_BYTES)
    return yield* invalidRequest(`${route} media exceeds the ${MAX_MEDIA_ENCODED_BYTES} byte encoded limit`);
  if (!base64 || base64.length % 4 !== 0) return yield* invalidRequest(`${route} media must contain valid base64`);
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.byteLength > MAX_MEDIA_DECODED_BYTES)
    return yield* invalidRequest(`${route} media exceeds the ${MAX_MEDIA_DECODED_BYTES} byte decoded limit`);
  if (bytes.toString('base64') !== base64) return yield* invalidRequest(`${route} media must contain canonical base64`);
  return { mime, base64, dataUrl: `data:${mime};base64,${base64}`, bytes } satisfies ValidatedMedia;
});

export const validateToolFile = (route: string, part: ToolFileContent, supportedMimes: ReadonlySet<string>) =>
  validateMedia(route, { type: 'media', mediaType: part.mime, data: part.uri, filename: part.name }, supportedMimes);

export const trimBaseUrl = (value: string) => value.replace(/\/+$/, '');

export const toolResultText = (part: ToolResultPart) => {
  if (part.result.type === 'text') return String(part.result.value);
  if (part.result.type === 'error') {
    const value = part.result.value;
    const prototype = typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value);
    const structured = Array.isArray(value) || prototype === Object.prototype || prototype === null;
    return structured && isJson(value) ? encodeJson(value) : String(value);
  }
  return encodeJson(part.result.value);
};

export interface ToolIdSpelling {
  readonly outside: RegExp;
  readonly maxLength?: number;
}

export const toolId = (id: string, spelling: ToolIdSpelling): string => {
  const spelled = id.replaceAll(spelling.outside, '_');
  const maxLength = spelling.maxLength ?? Number.POSITIVE_INFINITY;
  if (spelled === id && id.length > 0 && id.length <= maxLength) return id;
  const suffix = `_${fnv1a(id)}`;
  return spelled.slice(0, maxLength - suffix.length) + suffix;
};

const fnv1a = (text: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const invalidRequest = (message: string) =>
  new LLMError({
    module: 'ProviderShared',
    method: 'request',
    reason: new InvalidRequestReason({ message }),
  });

export const matchToolChoice = Effect.fnUntraced(function* <Auto, None, Required, Tool>(
  route: string,
  toolChoice: NonNullable<LLMRequest['toolChoice']>,
  cases: {
    readonly auto: () => Auto;
    readonly none: () => None;
    readonly required: () => Required;
    readonly tool: (name: string) => Tool;
  },
) {
  if (toolChoice.type === 'auto') return cases.auto();
  if (toolChoice.type === 'none') return cases.none();
  if (toolChoice.type === 'required') return cases.required();
  if (!toolChoice.name) return yield* invalidRequest(`${route} tool choice requires a tool name`);
  return cases.tool(toolChoice.name);
});

type ContentType = ContentPart['type'];

const formatContentTypes = (types: ReadonlyArray<ContentType>) => {
  if (types.length <= 1) return types[0] ?? '';
  if (types.length === 2) return `${types[0]} and ${types[1]}`;
  return `${types.slice(0, -1).join(', ')}, and ${types.at(-1)}`;
};

export const supportsContent = <const Type extends ContentType>(
  part: ContentPart,
  types: ReadonlyArray<Type>,
): part is Extract<ContentPart, { readonly type: Type }> => (types as ReadonlyArray<ContentType>).includes(part.type);

export const unsupportedContent = (route: string, role: LLMRequest['messages'][number]['role'], types: ReadonlyArray<ContentType>) =>
  invalidRequest(`${route} ${role} messages only support ${formatContentTypes(types)} content for now`);

export const validateWith =
  <A, I, E extends { readonly message: string }>(decode: (input: I) => Effect.Effect<A, E>) =>
  (payload: I) =>
    decode(payload).pipe(Effect.mapError((error) => invalidRequest(error.message)));

export const jsonPost = (input: { readonly url: string; readonly body: string; readonly headers?: Headers.Input }) => {
  const headers = namedHeaders(input.headers ?? {});
  return HttpClientRequest.post(input.url).pipe(
    HttpClientRequest.setHeaders(headers),
    HttpClientRequest.bodyText(input.body, 'application/json'),
    HttpClientRequest.updateHeaders((written) => namedHeaders(written, headerNames(headers))),
  );
};
