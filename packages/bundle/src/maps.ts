import { resolve } from 'node:path';

type SourceMap = { readonly sources?: readonly string[]; readonly sourceRoot?: string };

export const absoluteSources = (map: string, from: string): string => {
  const read = JSON.parse(map) as SourceMap;
  return JSON.stringify({
    ...read,
    sourceRoot: undefined,
    sources: (read.sources ?? []).map((source) => resolve(from, read.sourceRoot ?? '', source)),
  });
};
