import { chmodSync, closeSync, fchmodSync, mkdirSync, openSync, symlinkSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { entryPath, entryRefusal } from '../contract/wire/archive.js';
import { walkTarball } from './tarball.js';

export const unpackTarball = async (file: string, into: string, signal: AbortSignal): Promise<void> => {
  const root = resolve(into);
  mkdirSync(root, { recursive: true });
  const made = new Set([root]);
  const modes = new Map<string, number>();
  const links = new Map<string, string>();
  let opened: number | null = null;
  const directory = (path: string): void => {
    if (made.has(path)) return;
    directory(dirname(path));
    mkdirSync(path, { mode: 0o755 });
    made.add(path);
  };
  try {
    await walkTarball(
      file,
      (entry) => {
        const refused = entryRefusal(entry);
        if (refused !== null) throw new Error(refused);
        if (entry.kind !== 'file' && entry.size !== 0) throw new Error(`${entry.name} is not a file but declares content`);
        const path = join(root, entryPath(entry.name));
        const mode = entry.mode & 0o777;
        if (entry.kind === 'directory') {
          directory(path);
          modes.set(path, mode);
          return null;
        }
        directory(dirname(path));
        if (entry.kind === 'link') {
          links.set(path, entry.target!);
          return null;
        }
        const descriptor = openSync(path, 'w', mode);
        opened = descriptor;
        return {
          chunk: (bytes) => {
            let at = 0;
            while (at < bytes.length) {
              const written = writeSync(descriptor, bytes, at, bytes.length - at);
              if (written === 0) throw new Error(`${entry.name} accepted no archive bytes`);
              at += written;
            }
          },
          end: () => {
            fchmodSync(descriptor, mode);
            closeSync(descriptor);
            opened = null;
          },
        };
      },
      signal,
    );
    for (const [path, target] of links) symlinkSync(target, path);
    for (const path of [...made].reverse()) {
      const mode = modes.get(path);
      if (mode !== undefined) chmodSync(path, mode);
    }
  } finally {
    if (opened !== null) closeSync(opened);
  }
};
