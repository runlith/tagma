import { readFile, rename, writeFile } from 'node:fs/promises';
import { Data, Effect, Schema } from 'effect';
import { formatMarkerSchema } from '../contract/wire/storage.js';

export type TreeMarker =
  | { readonly kind: 'absent' }
  | { readonly kind: 'read'; readonly step: string | null }
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'unwritten'; readonly reason: string };

export class MarkerUnwritten extends Data.TaggedError('MarkerUnwritten')<{ readonly path: string; readonly message: string }> {}

const decodeMarker = Schema.decodeUnknownResult(Schema.fromJsonString(formatMarkerSchema));

export function markerOf(text: string): TreeMarker {
  const decoded = decodeMarker(text);
  return decoded._tag === 'Success'
    ? { kind: 'read', step: decoded.success.step ?? null }
    : { kind: 'unreadable', reason: decoded.failure.message };
}

export const markerText = (step: string | null): string => `${JSON.stringify(step === null ? {} : { step }, null, 2)}\n`;

export const readMarker = (path: string): Effect.Effect<TreeMarker> =>
  Effect.map(Effect.result(Effect.tryPromise({ try: () => readFile(path, 'utf8'), catch: (cause) => cause })), (read): TreeMarker => {
    if (read._tag === 'Success') return markerOf(read.success);
    const code = (read.failure as NodeJS.ErrnoException | undefined)?.code;
    return code === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable', reason: String(read.failure) };
  });

export const writeMarker = (path: string, step: string): Effect.Effect<void, MarkerUnwritten> =>
  Effect.tryPromise({
    try: async () => {
      const staged = `${path}.${process.pid}.tmp`;
      await writeFile(staged, markerText(step));
      await rename(staged, path);
    },
    catch: (cause) => new MarkerUnwritten({ path, message: String(cause) }),
  });

export const markerStep = (marker: TreeMarker): string | null => (marker.kind === 'read' ? marker.step : null);
