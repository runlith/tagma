import { HttpServerResponse } from 'effect/http';

const RANGE = /^bytes=(\d*)-(\d*)$/u;

export type Span = { readonly start: number; readonly end: number };

export const spanOf = (range: string | undefined, size: number): Span | 'unsatisfiable' | null => {
  const asked = range === undefined ? null : RANGE.exec(range.trim());
  const from = asked?.[1] ?? '';
  const to = asked?.[2] ?? '';
  if (asked === null || (from === '' && to === '')) return null;
  const start = from === '' ? Math.max(0, size - Number(to)) : Number(from);
  const end = from === '' || to === '' ? size - 1 : Math.min(Number(to), size - 1);
  return start > end || start >= size ? 'unsatisfiable' : { start, end };
};

export const rangedFile = (
  file: Blob,
  size: number,
  range: string | undefined,
  headers: Readonly<Record<string, string>>,
): HttpServerResponse.HttpServerResponse => {
  const served = { ...headers, 'accept-ranges': 'bytes' };
  const asked = spanOf(range, size);
  if (asked === 'unsatisfiable')
    return HttpServerResponse.fromWeb(new Response(null, { status: 416, headers: { ...served, 'content-range': `bytes */${size}` } }));
  if (asked === null) return HttpServerResponse.fromWeb(new Response(file, { status: 200, headers: served }));
  return HttpServerResponse.fromWeb(
    new Response(file.slice(asked.start, asked.end + 1), {
      status: 206,
      headers: { ...served, 'content-range': `bytes ${asked.start}-${asked.end}/${size}` },
    }),
  );
};
