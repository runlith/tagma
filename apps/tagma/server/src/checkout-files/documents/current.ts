import { readFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { bytesDigest, contentOf, looksBinary, versionContentLimit } from '@runlith/files/content';
import type { Working } from '@runlith/files/working';
import type { DocumentFrame } from '../contract/wire/document.js';

export type TextCurrent = {
  readonly kind: 'text';
  readonly digest: string;
  readonly text: string | null;
  readonly readOnly: null | 'undecodable';
  readonly size: number;
  readonly key: string | null;
  readonly write?: string;
};

export type Current =
  | TextCurrent
  | { readonly kind: 'binary'; readonly size: number }
  | { readonly kind: 'tooLarge'; readonly size: number }
  | { readonly kind: 'gone' }
  | { readonly kind: 'moved'; readonly path: string }
  | { readonly kind: 'unreadable'; readonly reason: string };

const lossy = new TextDecoder('utf-8', { ignoreBOM: true });

const lines = (text: string): string => text.replaceAll('\r\n', '\n');

const hasBom = (bytes: Uint8Array): boolean => bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

const codeOf = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined;

export const keyOf = (working: Working): string | null => (working.kind === 'file' || working.kind === 'link' ? working.key : null);

export const frameOf = (current: Current): DocumentFrame | null => {
  switch (current.kind) {
    case 'text':
      return current.text === null
        ? null
        : {
            kind: 'whole',
            digest: current.digest,
            text: current.text,
            readOnly: current.readOnly,
            size: current.size,
            write: current.write,
          };
    case 'binary':
    case 'tooLarge':
      return { kind: current.kind, size: current.size };
    case 'gone':
      return { kind: 'gone' };
    case 'moved':
      return { kind: 'moved', path: current.path };
    case 'unreadable':
      return { kind: 'unreadable', reason: current.reason };
  }
};

export const queued = (
  frames: readonly DocumentFrame[],
  frame: DocumentFrame,
  whole: DocumentFrame | null,
  limit: number,
): DocumentFrame[] => (frames.length >= limit ? (whole === null ? [] : [whole]) : [...frames, frame]);

export const sameCurrent = (left: Current, right: Current): boolean => {
  switch (left.kind) {
    case 'text':
      return right.kind === 'text' && left.digest === right.digest && left.readOnly === right.readOnly;
    case 'binary':
    case 'tooLarge':
      return right.kind === left.kind && left.size === right.size;
    case 'gone':
      return right.kind === 'gone';
    case 'moved':
      return right.kind === 'moved' && left.path === right.path;
    case 'unreadable':
      return right.kind === 'unreadable' && left.reason === right.reason;
  }
};

export const textOf = (digest: string, decoded: string, size: number, write?: string): TextCurrent => ({
  kind: 'text',
  digest,
  text: lines(decoded),
  readOnly: null,
  size,
  key: null,
  write,
});

export const readCurrent = Effect.fnUntraced(function* (
  path: string,
  stat: Effect.Effect<Working>,
  standing: Current | null,
): Effect.fn.Return<Current> {
  const before = yield* stat;
  if (before.kind === 'absent') return { kind: 'gone' };
  if (before.kind === 'unread') return { kind: 'unreadable', reason: `${path}: ${before.cause}` };
  const keyed = keyOf(before);
  if (standing?.kind === 'text' && keyed !== null && standing.key === keyed && standing.text !== null) return standing;
  if (before.kind === 'file' && before.size > versionContentLimit) return { kind: 'tooLarge', size: before.size };
  const read = yield* Effect.result(Effect.tryPromise({ try: () => readFile(path), catch: (cause) => cause }));
  if (read._tag === 'Failure') {
    if (codeOf(read.failure) === 'ENOENT') return { kind: 'gone' };
    return { kind: 'unreadable', reason: read.failure instanceof Error ? read.failure.message : String(read.failure) };
  }
  const data = read.success;
  if (data.length > versionContentLimit) return { kind: 'tooLarge', size: data.length };
  if (looksBinary(data)) return { kind: 'binary', size: data.length };
  const after = yield* stat;
  return currentOf(data, keyed !== null && keyed === keyOf(after) ? keyed : null);
});

const currentOf = (data: Uint8Array, key: string | null): Current => {
  const content = contentOf(data);
  if (content.kind === 'binary') return { kind: 'binary', size: data.length };
  const digest = bytesDigest(data);
  if (content.kind === 'undecodable') {
    const text = lossy.decode(hasBom(data) ? data.subarray(3) : data);
    return { kind: 'text', digest, text: lines(text), readOnly: 'undecodable', size: data.length, key };
  }
  return { kind: 'text', digest, text: lines(content.text), readOnly: null, size: data.length, key };
};
