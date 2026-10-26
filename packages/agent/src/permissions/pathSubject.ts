import type { PermissionSubject } from './vocabulary';

const DRIVE_ROOT = /^[A-Za-z]:[\\/]/;

type Dialect = { readonly separators: RegExp; readonly join: string; readonly same: (left: string, right: string) => boolean };

const POSIX: Dialect = { separators: /\//, join: '/', same: (left, right) => left === right };

const WINDOWS: Dialect = {
  separators: /[\\/]/,
  join: '\\',
  same: (left, right) => left.toLowerCase() === right.toLowerCase(),
};

const absolute = (dialect: Dialect, path: string) => (dialect === WINDOWS ? DRIVE_ROOT.test(path) : path.startsWith('/'));

function segments(dialect: Dialect, base: readonly string[], path: string): string[] {
  const parts = absolute(dialect, path) ? [] : [...base];
  for (const part of path.split(dialect.separators)) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (dialect === WINDOWS && parts.length === 1) continue;
      parts.pop();
    } else parts.push(part);
  }
  return parts;
}

export function pathSubject(kind: PermissionSubject['kind'], cwd: string, target: string): PermissionSubject {
  const dialect = DRIVE_ROOT.test(cwd) ? WINDOWS : POSIX;
  const from = segments(dialect, [], cwd);
  const to = segments(dialect, from, target);
  if (dialect === WINDOWS && !dialect.same(from[0] ?? '', to[0] ?? '')) {
    return { kind, value: to.length === 1 ? `${to[0]}\\` : to.join('\\'), file: true };
  }
  let shared = 0;
  while (shared < from.length && shared < to.length && dialect.same(from[shared]!, to[shared]!)) shared++;
  const value = [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join(dialect.join);
  return { kind, value: value || '.', file: true };
}

export type FileAccess = PermissionSubject & { readonly kind: 'read' | 'write'; readonly file: true };

export function fileAccesses(subjects: readonly PermissionSubject[]): readonly FileAccess[] {
  return subjects.filter(
    (subject): subject is FileAccess => subject.file === true && (subject.kind === 'read' || subject.kind === 'write'),
  );
}
