const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;

const BATCH_BYTES = 16 * 1024 * 1024;

export type Splitter = { readonly push: (chunk: Uint8Array) => void; readonly end: () => void };

export const eventSplitter = (take: (events: readonly unknown[]) => void): Splitter => {
  const decoder = new TextDecoder();
  let depth = 0;
  let inString = false;
  let escaped = false;
  let keyStart = -1;
  let keyParts: Uint8Array[] = [];
  let lastKey = '';
  let listDepth = -1;
  let start = -1;
  let parts: Uint8Array[] = [];
  let batch: Uint8Array[] = [];
  let batched = 0;

  const joined = (pieces: readonly Uint8Array[]): Uint8Array => {
    if (pieces.length === 1) return pieces[0]!;
    const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.byteLength, 0));
    let at = 0;
    for (const piece of pieces) {
      out.set(piece, at);
      at += piece.byteLength;
    }
    return out;
  };

  const flush = () => {
    if (batch.length === 0) return;
    const text = `[${batch.map((piece) => decoder.decode(piece)).join(',')}]`;
    batch = [];
    batched = 0;
    take(JSON.parse(text) as unknown[]);
  };

  const element = (piece: Uint8Array) => {
    batch.push(piece);
    batched += piece.byteLength;
    if (batched >= BATCH_BYTES) flush();
  };

  return {
    push: (chunk) => {
      for (let at = 0; at < chunk.length; at += 1) {
        const byte = chunk[at]!;
        if (inString) {
          if (escaped) escaped = false;
          else if (byte === BACKSLASH) escaped = true;
          else if (byte === QUOTE) {
            inString = false;
            if (keyStart >= 0) {
              keyParts.push(chunk.subarray(keyStart, at));
              lastKey = decoder.decode(joined(keyParts));
              keyStart = -1;
              keyParts = [];
            }
          }
          continue;
        }
        if (byte === QUOTE) {
          inString = true;
          if (depth === 1 && listDepth < 0) keyStart = at + 1;
          continue;
        }
        if (byte === OPEN_BRACE || byte === OPEN_BRACKET) {
          depth += 1;
          if (depth === 1 && byte === OPEN_BRACKET) listDepth = 1;
          else if (depth === 2 && byte === OPEN_BRACKET && lastKey === 'traceEvents') listDepth = 2;
          else if (listDepth >= 0 && depth === listDepth + 1) start = at;
          continue;
        }
        if (byte === CLOSE_BRACE || byte === CLOSE_BRACKET) {
          if (listDepth >= 0 && depth === listDepth + 1 && start >= 0) {
            parts.push(chunk.subarray(start, at + 1));
            element(joined(parts));
            parts = [];
            start = -1;
          } else if (depth === listDepth) listDepth = -1;
          depth -= 1;
        }
      }
      if (start >= 0) {
        parts.push(chunk.slice(start));
        start = 0;
      }
      if (keyStart >= 0) {
        keyParts.push(chunk.slice(keyStart));
        keyStart = 0;
      }
    },
    end: flush,
  };
};
