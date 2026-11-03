import { join, resolve, sep } from 'node:path';

type SourceMap = { readonly sources?: readonly string[]; readonly sourceRoot?: string };

export type SourceMapOrigin = { readonly from: string; readonly to: string };

const namedByOrigin = (path: string, origin: SourceMapOrigin | undefined): string => {
  if (origin === undefined) return path;
  const from = resolve(origin.from);
  if (path === from) return origin.to;
  return path.startsWith(`${from}${sep}`) ? join(origin.to, path.slice(from.length)) : path;
};

export const absoluteSources = (map: string, from: string, origin?: SourceMapOrigin): string => {
  const read = JSON.parse(map) as SourceMap;
  return JSON.stringify({
    ...read,
    sourceRoot: undefined,
    sources: (read.sources ?? []).map((source) => namedByOrigin(resolve(from, read.sourceRoot ?? '', source), origin)),
  });
};
