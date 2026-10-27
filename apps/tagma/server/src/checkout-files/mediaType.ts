export const mediaTypeOf = (path: string): string => Bun.file(path).type || 'application/octet-stream';
