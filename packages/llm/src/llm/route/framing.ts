import { Effect, Stream } from 'effect';
import * as ProviderShared from '../protocols/shared';
import type { LLMError } from '../schema/errors';

export interface Framing<Frame> {
  readonly id: string;
  readonly frame: (bytes: Stream.Stream<Uint8Array, LLMError>) => Stream.Stream<Frame, LLMError>;
}

const MAX_EVENT_CHARS = 10 * 1024 * 1024;

interface SseState {
  readonly line: ReadonlyArray<string>;
  readonly lineChars: number;
  readonly data: ReadonlyArray<string>;
  readonly dataChars: number;
  readonly swallowLeadingLf: boolean;
}

const initialState = (): SseState => ({ line: [], lineChars: 0, data: [], dataChars: 0, swallowLeadingLf: false });

const feed = (state: SseState, chunk: string): readonly [SseState, ReadonlyArray<string>] => {
  const events: string[] = [];
  let line = state.line as string[];
  let lineChars = state.lineChars;
  let data = state.data as string[];
  let dataChars = state.dataChars;
  let swallowLeadingLf = state.swallowLeadingLf;
  let lineStart = 0;

  if (swallowLeadingLf && chunk.length > 0) {
    lineStart = chunk.charCodeAt(0) === 10 ? 1 : 0;
    swallowLeadingLf = false;
  }

  for (let cursor = lineStart; cursor < chunk.length; cursor++) {
    const code = chunk.charCodeAt(cursor);
    if (code !== 10 && code !== 13) continue;

    if (cursor > lineStart) {
      const part = chunk.slice(lineStart, cursor);
      line.push(part);
      lineChars += part.length;
    }
    const value = line.length === 0 ? '' : line.length === 1 ? line[0]! : line.join('');
    line = [];
    lineChars = 0;

    if (value.length === 0) {
      if (data.length > 0) {
        events.push(data.join('\n'));
        data = [];
        dataChars = 0;
      }
    } else {
      const colon = value.indexOf(':');
      const named = colon >= 0;
      const field = value.slice(0, named ? colon : value.length);
      if (field === 'data') {
        const from = named ? (value.charCodeAt(colon + 1) === 32 ? colon + 2 : colon + 1) : value.length;
        const dataLine = value.slice(from);
        data.push(dataLine);
        dataChars += dataLine.length + 1;
      }
    }

    const followedByLf = code === 13 && cursor + 1 < chunk.length && chunk.charCodeAt(cursor + 1) === 10;
    if (followedByLf) cursor++;
    swallowLeadingLf = code === 13 && !followedByLf && cursor + 1 === chunk.length;
    lineStart = cursor + 1;
  }

  if (lineStart < chunk.length) {
    const part = chunk.slice(lineStart);
    line.push(part);
    lineChars += part.length;
  }
  return [{ line, lineChars, data, dataChars, swallowLeadingLf }, events];
};

const frameSse = (bytes: Stream.Stream<Uint8Array, LLMError>): Stream.Stream<string, LLMError> =>
  bytes.pipe(
    Stream.decodeText(),
    Stream.mapAccumArrayEffect(initialState, (state: SseState, chunks: ReadonlyArray<string>) => {
      let next = state;
      const events: string[] = [];
      for (const chunk of chunks) {
        const [after, produced] = feed(next, chunk);
        next = after;
        if (produced.length > 0) events.push(...produced);
      }
      return next.lineChars + next.dataChars > MAX_EVENT_CHARS
        ? Effect.fail(
            ProviderShared.failureOf(undefined, {
              route: 'sse',
              message: `Pending SSE event exceeded the maximum size of ${MAX_EVENT_CHARS}`,
              family: 'invalid-output',
            }),
          )
        : Effect.succeed([next, events] as const);
    }),
    Stream.filter((data) => data.length > 0 && data !== '[DONE]'),
  );

export const sse: Framing<string> = { id: 'sse', frame: frameSse };

export const json: Framing<string> = {
  id: 'json',
  frame: (bytes) =>
    Stream.fromEffect(
      bytes.pipe(
        Stream.decodeText(),
        Stream.runFold(
          (): string[] => [],
          (chunks, text) => {
            chunks.push(text);
            return chunks;
          },
        ),
        Effect.map((chunks) => chunks.join('')),
      ),
    ),
};

export type { Framing as FramingDef };
