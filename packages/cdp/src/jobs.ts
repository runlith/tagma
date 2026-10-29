export type Job =
  | { readonly kind: 'json'; readonly text: string; readonly trim: number | null }
  | { readonly kind: 'bytes'; readonly text: string }
  | { readonly kind: 'chunk'; readonly text: string }
  | { readonly kind: 'heap'; readonly text: string; readonly file: string };

export type Chunk = { readonly bytes: Uint8Array; readonly eof: boolean };

export function chunkText(text: string): Chunk {
  const { result } = JSON.parse(text) as {
    readonly result?: { readonly data?: unknown; readonly base64Encoded?: unknown; readonly eof?: unknown };
  };
  if (typeof result?.data !== 'string') throw new Error('the stream read carries no data');
  const decoded = result.base64Encoded === true ? Buffer.from(result.data, 'base64') : Buffer.from(result.data, 'utf8');
  return { bytes: new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength), eof: result.eof === true };
}

export type JobAsk = { readonly id: number; readonly job: Job };

export type JobAnswer = { readonly id: number; readonly value: unknown } | { readonly id: number; readonly unreadable: string };

export function trimmed(value: unknown, limit: number): unknown {
  if (typeof value === 'string') return value.length > limit ? `${value.slice(0, limit)}…` : value;
  if (Array.isArray(value)) return value.map((item) => trimmed(item, limit));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, held] of Object.entries(value)) out[key] = trimmed(held, limit);
    return out;
  }
  return value;
}

export function bytesText(text: string): Uint8Array {
  const parsed = JSON.parse(text) as { readonly result?: { readonly data?: unknown } };
  const data = parsed.result?.data;
  if (typeof data !== 'string') throw new Error('the reply carries no base64 data');
  const decoded = Buffer.from(data, 'base64');
  return new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
}
