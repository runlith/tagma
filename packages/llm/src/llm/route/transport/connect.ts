import { gunzipSync } from 'node:zlib';
import { Effect, Stream } from 'effect';
import { Headers, HttpClientRequest } from 'effect/http';
import * as ProviderShared from '../../protocols/shared';
import {
  AuthenticationReason,
  InvalidRequestReason,
  LLMError,
  ProviderInternalReason,
  RateLimitReason,
  WIRE_EXCERPT_LIMIT,
} from '../../schema/errors';
import * as Auth from '../auth';
import { headerNames, namedHeaders } from '../../utils/headers';
import type { Framing } from '../framing';
import * as HttpTransport from './http';
import type { Transport } from './index';

const CONTENT_TYPE = 'application/connect+proto';
const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
const COMPRESSED = 0x01;
const END = 0x02;
const KNOWN_FLAGS = COMPRESSED | END;

export type ConnectFrame = { readonly _tag: 'Message'; readonly bytes: Uint8Array } | { readonly _tag: 'End' };

export interface Input<Body> {
  readonly encode: (body: Body) => Uint8Array;
}

export interface ConnectTransport<Body> extends Transport<Body, HttpTransport.HttpPrepared<ConnectFrame>, ConnectFrame> {}

type Source = { readonly _tag: 'Bytes'; readonly bytes: Uint8Array } | { readonly _tag: 'EOF' };

interface State {
  readonly header: Uint8Array;
  headerSize: number;
  flags: number;
  payload: Uint8Array | null;
  payloadSize: number;
  ended: boolean;
  eof: boolean;
}

class FrameFailure extends Error {
  constructor(
    message: string,
    readonly family: 'invalid-output' | 'torn-stream',
    readonly detail?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const initial = (): State => ({
  header: new Uint8Array(5),
  headerSize: 0,
  flags: 0,
  payload: null,
  payloadSize: 0,
  ended: false,
  eof: false,
});

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const trailer = (bytes: Uint8Array): LLMError | null => {
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch (cause) {
    throw new FrameFailure('The Connect end-stream trailer was not valid UTF-8 JSON', 'invalid-output', undefined, {
      cause,
    });
  }
  if (!record(value)) {
    throw new FrameFailure('The Connect end-stream trailer was not an object', 'invalid-output', text);
  }
  if (!Object.hasOwn(value, 'error')) return null;
  const error = value['error'];
  if (!record(error) || typeof error['code'] !== 'string' || typeof error['message'] !== 'string') {
    throw new FrameFailure('The Connect end-stream error was malformed', 'invalid-output', text);
  }
  if (Object.hasOwn(error, 'details') && !Array.isArray(error['details'])) {
    throw new FrameFailure('The Connect end-stream error details were malformed', 'invalid-output', text);
  }
  const code = error['code'];
  const details = error['details'];
  const detail = Array.isArray(details) && details.length > 0 ? ProviderShared.encodeJson(details).slice(0, WIRE_EXCERPT_LIMIT) : undefined;
  const message = detail === undefined ? error['message'] : `${error['message']} [details: ${detail}]`;
  const normalized = code.toLowerCase();
  const transient = new Set(['aborted', 'deadline_exceeded', 'internal', 'resource_exhausted', 'unavailable']).has(normalized);
  const fallback = ProviderShared.providerStreamFailure({
    module: 'ConnectTransport',
    refusal: { code, message },
    evidence: { eventType: 'connect.end', keys: Object.keys(error) },
    retryable: transient,
  });
  const safeMessage = fallback.reason.message;
  const reason = (() => {
    switch (normalized) {
      case 'unauthenticated':
        return new AuthenticationReason({ message: safeMessage, kind: 'invalid' });
      case 'permission_denied':
        return new AuthenticationReason({ message: safeMessage, kind: 'insufficient-permissions' });
      case 'resource_exhausted':
        return new RateLimitReason({ message: safeMessage });
      case 'invalid_argument':
      case 'not_found':
      case 'already_exists':
      case 'failed_precondition':
      case 'out_of_range':
      case 'unimplemented':
        return new InvalidRequestReason({ message: safeMessage });
      case 'aborted':
      case 'deadline_exceeded':
      case 'internal':
      case 'unavailable':
      case 'data_loss':
        return new ProviderInternalReason({ message: safeMessage });
      default:
        return null;
    }
  })();
  return reason === null ? fallback : new LLMError({ module: 'ConnectTransport', method: 'stream', reason });
};

const decoded = (payload: Uint8Array, compressed: boolean) => {
  if (!compressed) return payload;
  try {
    return new Uint8Array(gunzipSync(payload, { maxOutputLength: MAX_PAYLOAD_BYTES }));
  } catch (cause) {
    throw new FrameFailure('The Connect gzip envelope could not be decoded within its size limit', 'invalid-output', undefined, {
      cause,
    });
  }
};

const complete = (state: State, output: ConnectFrame[]) => {
  const payload = state.payload;
  if (payload === null) throw new FrameFailure('The Connect envelope had no payload buffer', 'invalid-output');
  const bytes = decoded(payload, (state.flags & COMPRESSED) !== 0);
  if (bytes.byteLength > MAX_PAYLOAD_BYTES) {
    throw new FrameFailure('The decoded Connect envelope exceeded the 16 MiB size limit', 'invalid-output');
  }
  if ((state.flags & END) !== 0) {
    const error = trailer(bytes);
    if (error) throw error;
    state.ended = true;
  } else {
    output.push({ _tag: 'Message', bytes });
  }
  state.headerSize = 0;
  state.flags = 0;
  state.payload = null;
  state.payloadSize = 0;
};

const bytes = (state: State, chunk: Uint8Array, output: ConnectFrame[]) => {
  let cursor = 0;
  while (cursor < chunk.byteLength) {
    if (state.ended) {
      throw new FrameFailure('The Connect stream carried bytes after its end-stream trailer', 'invalid-output');
    }
    if (state.payload === null) {
      const count = Math.min(5 - state.headerSize, chunk.byteLength - cursor);
      state.header.set(chunk.subarray(cursor, cursor + count), state.headerSize);
      state.headerSize += count;
      cursor += count;
      if (state.headerSize < 5) continue;

      state.flags = state.header[0]!;
      if ((state.flags & ~KNOWN_FLAGS) !== 0) {
        throw new FrameFailure(`The Connect envelope used unknown flags 0x${state.flags.toString(16)}`, 'invalid-output');
      }
      const size = new DataView(state.header.buffer, state.header.byteOffset, state.header.byteLength).getUint32(1, false);
      if (size > MAX_PAYLOAD_BYTES) {
        throw new FrameFailure('The Connect envelope exceeded the 16 MiB size limit', 'invalid-output');
      }
      state.payload = new Uint8Array(size);
      state.payloadSize = 0;
      if (size === 0) complete(state, output);
      continue;
    }

    const count = Math.min(state.payload.byteLength - state.payloadSize, chunk.byteLength - cursor);
    state.payload.set(chunk.subarray(cursor, cursor + count), state.payloadSize);
    state.payloadSize += count;
    cursor += count;
    if (state.payloadSize === state.payload.byteLength) complete(state, output);
  }
};

const eof = (state: State, output: ConnectFrame[]) => {
  state.eof = true;
  if (!state.ended) {
    throw new FrameFailure('The Connect stream ended without an end-stream trailer', 'torn-stream');
  }
  if (state.headerSize !== 0 || state.payload !== null) {
    throw new FrameFailure('The Connect stream ended inside an envelope', 'torn-stream');
  }
  output.push({ _tag: 'End' });
};

const failure = (cause: unknown) => {
  if (cause instanceof LLMError) return cause;
  if (cause instanceof FrameFailure) {
    return ProviderShared.failureOf(cause.cause, {
      module: 'ConnectTransport',
      method: 'frame',
      route: 'connect',
      message: cause.message,
      family: cause.family,
      excerpt: cause.detail,
    });
  }
  return ProviderShared.failureOf(cause, {
    module: 'ConnectTransport',
    method: 'frame',
    route: 'connect',
    message: 'The Connect stream could not be framed',
    family: 'invalid-output',
  });
};

const framing: Framing<ConnectFrame> = {
  id: 'connect',
  frame: (source) =>
    source.pipe(
      Stream.map((chunk): Source => ({ _tag: 'Bytes', bytes: chunk })),
      Stream.concat(Stream.succeed<Source>({ _tag: 'EOF' })),
      Stream.mapAccumArrayEffect(initial, (state, chunks) =>
        Effect.try({
          try: () => {
            const output: ConnectFrame[] = [];
            for (const chunk of chunks) {
              if (state.eof) throw new FrameFailure('The Connect stream continued after EOF', 'invalid-output');
              if (chunk._tag === 'EOF') eof(state, output);
              else bytes(state, chunk.bytes, output);
            }
            return [state, output] as const;
          },
          catch: failure,
        }),
      ),
    ),
};

const envelope = (payload: Uint8Array) => {
  const body = new Uint8Array(5 + payload.byteLength);
  new DataView(body.buffer, body.byteOffset, body.byteLength).setUint32(1, payload.byteLength, false);
  body.set(payload, 5);
  return body;
};

const hasOverlay = (body: Record<string, unknown> | undefined) => body !== undefined && Object.keys(body).length > 0;

export const make = <Body>(input: Input<Body>): ConnectTransport<Body> => ({
  id: 'http-connect',
  prepare: Effect.fnUntraced(function* (prepare) {
    if (hasOverlay(prepare.request.http?.body)) {
      return yield* ProviderShared.invalidRequest('http.body cannot overlay a binary Connect request');
    }
    const payload = yield* Effect.try({
      try: () => input.encode(prepare.body),
      catch: (cause) => ProviderShared.invalidRequest(`Connect request encoding failed: ${String(cause)}`),
    });
    if (payload.byteLength > MAX_PAYLOAD_BYTES) {
      return yield* ProviderShared.invalidRequest('Connect request payload exceeds the 16 MiB size limit');
    }
    const body = envelope(payload);
    const url = HttpTransport.requestUrl(prepare);
    const declared = namedHeaders({
      ...prepare.headers?.({ request: prepare.request }),
      ...prepare.request.http?.headers,
    });
    const headers = namedHeaders(
      Headers.setAll(declared, {
        'content-type': CONTENT_TYPE,
        'connect-protocol-version': '1',
      }),
      headerNames(declared),
    );
    const authenticated = yield* Auth.toEffect(prepare.auth)({
      request: prepare.request,
      method: 'POST',
      url,
      body,
      headers,
    });
    const ordered = namedHeaders(authenticated, prepare.request.http?.headerOrder);
    return {
      request: HttpClientRequest.post(url).pipe(
        HttpClientRequest.setHeaders(ordered),
        HttpClientRequest.bodyUint8Array(body, CONTENT_TYPE),
        HttpClientRequest.updateHeaders((headers) => namedHeaders(headers, headerNames(ordered))),
      ),
      framing,
    };
  }),
  frames: HttpTransport.frames,
});
