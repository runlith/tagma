import { RUNTIME_PART } from './layout.js';
import { EXECUTIONS } from './manifest.js';

export const EXECUTIONS_RUNTIME = `${EXECUTIONS}/${RUNTIME_PART}`;

export type ArchiveEntry = {
  readonly name: string;
  readonly kind: 'file' | 'directory' | 'link' | 'hard link' | 'other';
  readonly target: string | null;
};

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/u;

export const entryPath = (name: string): string => name.replace(/^\.\//u, '').replace(/\/$/u, '');

const nameRefusal = (path: string): string | null => {
  if (path === '' || path === '.') return null;
  if (CONTROL.test(path)) return `an entry's name carries a control character`;
  if (path.startsWith('/')) return `${path} is named from the root of the machine`;
  const segments = path.split('/');
  if (segments.includes('..')) return `${path} climbs out of the archive`;
  if (segments.at(-1)!.startsWith('._')) return `${path} is an AppleDouble file`;
  return null;
};

const linkStaysInside = (path: string, target: string): boolean => {
  let depth = path.split('/').length - 1;
  let climbing = true;
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') {
      climbing = false;
      depth += 1;
      continue;
    }
    if (!climbing) return false;
    depth -= 1;
    if (depth < 0) return false;
  }
  return true;
};

export const entryRefusal = (entry: ArchiveEntry): string | null => {
  const path = entryPath(entry.name);
  const named = nameRefusal(path);
  if (named !== null) return named;
  if (entry.kind === 'hard link') return `${entry.name} is a hard link`;
  if (entry.kind === 'other') return `${entry.name} is no file, directory or symbolic link`;
  if (entry.kind !== 'link') return null;
  const target = entry.target ?? '';
  if (target === '' || target.startsWith('/') || !linkStaysInside(path, target)) return `${entry.name} links to a path outside the archive`;
  return null;
};
