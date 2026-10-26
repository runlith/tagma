import * as path from 'node:path';
import { Data, Effect, FileSystem } from 'effect';

export class ContextFileUnreadable extends Data.TaggedError('ContextFileUnreadable')<{
  readonly path: string;
  readonly cause: unknown;
}> {}

export type ContextFileRequest = {
  readonly cwd: string;
  readonly root: string;
  readonly globalDirectories?: readonly string[];
  readonly names: readonly string[];
  readonly strip?: (body: string) => string;
};

export type ContextFile = {
  readonly path: string;
  readonly directory: string;
  readonly name: string;
  readonly body: string;
};

export const readContextFiles = Effect.fn('ContextFiles.read')(function* (request: ContextFileRequest) {
  const fs = yield* FileSystem.FileSystem;
  const directories = [...(request.globalDirectories ?? []), ...chain(request.cwd, request.root)];
  const found: ContextFile[] = [];

  for (const directory of directories) {
    for (const name of request.names) {
      const file = path.join(directory, name);
      const unreadable = (cause: unknown) => new ContextFileUnreadable({ path: file, cause });
      const readable = yield* fs.exists(file).pipe(Effect.mapError(unreadable));
      if (!readable) continue;
      const raw = yield* fs.readFileString(file).pipe(Effect.mapError(unreadable));
      const body = (request.strip ? request.strip(raw) : raw).trim();
      if (body.length > 0) found.push({ path: file, directory, name, body });
      break;
    }
  }

  return found;
});

function chain(cwd: string, root: string): string[] {
  const from = path.resolve(cwd);
  const top = path.resolve(root);
  if (from !== top && !from.startsWith(`${top}${path.sep}`)) return [top];
  const directories: string[] = [];
  let current = from;
  while (true) {
    directories.push(current);
    if (current === top) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories.reverse();
}
