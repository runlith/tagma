import { HttpServerResponse } from 'effect/http';
import { spanOf } from '../../platform/contract/service/route.js';

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
