import { Effect, type FileSystem, type PlatformError, Stream } from 'effect';

export const versionContentLimit = 16 * 1024 * 1024;

const text = new TextDecoder('utf-8', { ignoreBOM: true });

const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export const BINARY_PROBE = 8000;

export type TextContent = { readonly kind: 'text'; readonly text: string; readonly bom: boolean };

export type Content = TextContent | { readonly kind: 'binary' } | { readonly kind: 'undecodable' };

export const withBom = (content: TextContent): string => (content.bom ? `\uFEFF${content.text}` : content.text);

export const looksBinary = (bytes: Uint8Array): boolean => bytes.includes(0);

export const looksBinaryText = (text: string): boolean => text.includes('\0');

export function contentOf(bytes: Uint8Array, options: { readonly partial?: boolean } = {}): Content {
  if (looksBinary(bytes)) return { kind: 'binary' };
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    const decoder = options.partial ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }) : strict;
    return { kind: 'text', text: decoder.decode(bom ? bytes.subarray(3) : bytes, { stream: options.partial === true }), bom };
  } catch {
    return { kind: 'undecodable' };
  }
}

export const fileText = (fs: FileSystem.FileSystem, path: string): Effect.Effect<string, PlatformError.PlatformError> =>
  Effect.map(fs.readFile(path), (bytes) => text.decode(bytes));

export function contentDigest(text: string): string {
  return new Bun.CryptoHasher('sha256').update(text).digest('hex').slice(0, 16);
}

export function bytesDigest(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex').slice(0, 16);
}

export const streamedDigest = (fs: FileSystem.FileSystem, path: string): Effect.Effect<string, PlatformError.PlatformError> =>
  Effect.suspend(() => {
    const hasher = new Bun.CryptoHasher('sha256');
    return Effect.as(
      Stream.runForEach(fs.stream(path), (chunk) => Effect.sync(() => hasher.update(chunk))),
      undefined,
    ).pipe(Effect.map(() => hasher.digest('hex').slice(0, 16)));
  });

export const filePrefix = Effect.fn('content.filePrefix')(function* (fs: FileSystem.FileSystem, path: string, length: number) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const file = yield* fs.open(path);
      const bytes = new Uint8Array(length);
      let read = 0;
      while (read < length) {
        const count = yield* file.read(bytes.subarray(read));
        if (count === 0) break;
        read += count;
      }
      return bytes.subarray(0, read);
    }),
  );
});

export type FileContent = { readonly bytes: Uint8Array; readonly text: string };

export const fileContent = (fs: FileSystem.FileSystem, path: string): Effect.Effect<FileContent, PlatformError.PlatformError> =>
  Effect.map(fs.readFile(path), (bytes) => ({ bytes, text: text.decode(bytes) }));

export function windowMatches(text: string, window: string): readonly number[] {
  if (window === '') return text === '' ? [0] : [];
  const found: number[] = [];
  for (let at = text.indexOf(window); at !== -1; at = text.indexOf(window, at + 1)) {
    const opensLine = at === 0 || text[at - 1] === '\n';
    const closesLine = window.endsWith('\n') || at + window.length === text.length;
    if (opensLine && closesLine) found.push(at);
  }
  return found;
}
