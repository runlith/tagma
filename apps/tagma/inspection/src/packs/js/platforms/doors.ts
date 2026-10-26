import { exported, exportMap, exportOf, type Member } from '@runlith/code-facts/js/workspace';
import { posix } from 'node:path';
import { admits, type Declared, type Form, type Platform, type Running } from './declaration';

export type Door = {
  readonly id: string;
  readonly key: string;
  readonly form: 'import' | 'require';
  readonly entry: string;
  readonly package: string;
  readonly platform: Platform;
  readonly file?: string;
  readonly manifest: string;
  readonly problem?: string;
  readonly marker?: string;
};

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const platformsOf = (value: unknown, declared: Declared): readonly Platform[] => {
  const found = new Set<Platform>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!record(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'types') continue;
      if (Object.hasOwn(declared, key)) found.add(key);
      visit(child);
    }
  };
  visit(value);
  return [...found];
};

const markersOf = (value: unknown, platform: Platform, active: ReadonlySet<string>): readonly unknown[] => {
  if (Array.isArray(value)) return value.flatMap((item) => markersOf(item, platform, active));
  if (!record(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === platform ? [child] : key === 'default' || active.has(key) ? markersOf(child, platform, active) : [],
  );
};

const hasRequire = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(hasRequire)
    : record(value) && Object.entries(value).some(([key, child]) => key === 'require' || hasRequire(child));

export const packageOf = (specifier: string): string =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');
export const entryOf = (name: string, specifier: string): string => (name === specifier ? '.' : `.${specifier.slice(name.length)}`);
export const doorId = (name: string, entry: string): string => `${name}${entry === '.' ? '' : entry.slice(1)}`;
export const manifestOf = (member: Member): string => posix.join(member.dir, 'package.json');

export const fillOf = (pattern: string, path: string): string | undefined => {
  const at = pattern.indexOf('*');
  if (at === -1) return pattern === path ? '' : undefined;
  const prefix = pattern.slice(0, at),
    suffix = pattern.slice(at + 1);
  return path.startsWith(prefix) && path.endsWith(suffix) && path.length > prefix.length + suffix.length
    ? path.slice(prefix.length, path.length - suffix.length)
    : undefined;
};

const targetOf = (member: Member, entry: string, conditions: ReadonlySet<string>): string | undefined => {
  if (member.manifest.exports === undefined) {
    const named = entry === '.' ? (typeof member.manifest.main === 'string' ? member.manifest.main : 'index.js') : entry;
    const target = named.startsWith('.') ? named : `./${named}`;
    return target.split('/').some((part) => part === '..' || part === 'node_modules') ? undefined : posix.join(member.dir, target);
  }
  const target = exported(member.manifest.exports, entry, conditions);
  if (
    typeof target !== 'string' ||
    !target.startsWith('./') ||
    target
      .split('/')
      .slice(1)
      .some((part) => part === '..' || part === 'node_modules')
  )
    return undefined;
  return posix.join(member.dir, target);
};

const targetsOf = (value: unknown): readonly string[] =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(targetsOf)
      : record(value)
        ? Object.values(value).flatMap(targetsOf)
        : [];

export const outputsOf = (member: Member, has: (path: string) => boolean): readonly string[] => {
  const roots = new Set<string>();
  const named = [member.manifest.main, member.manifest.bin]
    .flatMap(targetsOf)
    .map((one) => (one.startsWith('.') || one.startsWith('/') ? one : `./${one}`));
  for (const target of [...targetsOf(member.manifest.exports), ...named]) {
    if (!target.startsWith('./')) continue;
    const parts = target.slice(2).split('/');
    if (
      parts.length < 2 ||
      parts.some((part) => part === '' || part === '.' || part === '..' || part === 'node_modules' || part.includes('*'))
    )
      continue;
    if (!has(posix.join(member.dir, target))) roots.add(posix.join(member.dir, parts[0]!));
  }
  return [...roots];
};

export function resolveDoor(
  name: string,
  member: Member,
  entry: string,
  platform: Platform,
  running: Running,
  form: Form = 'import',
): Door {
  const { conditions } = running;
  const active = conditions(platform, form);
  const file = targetOf(member, entry, active);
  const selected = exportOf(member.manifest.exports, entry);
  const marked = Object.keys(running.declared).filter((one) => markersOf(selected?.value, one, conditions(one, form)).length > 0);
  let marker: string | undefined;
  for (const value of markersOf(selected?.value, platform, active)) {
    const target = exported({ '.': value }, '.', active);
    const marked =
      typeof target === 'string'
        ? posix.join(member.dir, selected?.fill === undefined ? target : target.replaceAll('*', selected.fill))
        : undefined;
    if (marked !== file) marker = `The ${platform} marker does not name the file its runtime selects`;
  }
  return {
    id: doorId(name, entry),
    key: `${doorId(name, entry)}\0${form}`,
    form,
    entry,
    package: name,
    platform,
    manifest: manifestOf(member),
    file,
    problem: admits(running.declared, platform, marked) ? undefined : `no ${platform}`,
    marker,
  };
}

export function declaredDoors(name: string, member: Member, paths: readonly string[], running: Running): readonly Door[] {
  const { conditions } = running;
  if (
    member.manifest.exports === undefined ||
    member.manifest.exports === null ||
    (record(member.manifest.exports) && Object.keys(member.manifest.exports).length === 0)
  )
    return [];
  const doors: Door[] = [];
  for (const [pattern, value] of Object.entries(exportMap(member.manifest.exports))) {
    if (value === null) continue;
    const declared = platformsOf(value, running.declared);
    const forms: readonly ('import' | 'require')[] = hasRequire(value) ? ['import', 'require'] : ['import'];
    for (const platform of declared.length === 0 ? [running.shipped] : declared)
      for (const form of forms) {
        if (!pattern.includes('*')) {
          doors.push(resolveDoor(name, member, pattern, platform, running, form));
          continue;
        }
        const target = exported({ '.': value }, '.', conditions(platform, form));
        const aims = typeof target === 'string' ? posix.join(member.dir, target) : undefined;
        const entries =
          aims === undefined
            ? []
            : paths.flatMap((path) => {
                const fill = fillOf(aims, path);
                const entry = fill === undefined ? undefined : pattern.replaceAll('*', fill);
                return entry === undefined || exportOf(member.manifest.exports, entry)?.key !== pattern ? [] : [entry];
              });
        if (entries.length === 0) {
          const id = doorId(name, pattern);
          doors.push({ id, key: `${id}\0${form}`, form, entry: pattern, package: name, platform, manifest: manifestOf(member) });
        }
        for (const entry of entries) doors.push(resolveDoor(name, member, entry, platform, running, form));
      }
  }
  return [...new Map(doors.map((door) => [`${door.key}\0${door.platform}`, door])).values()];
}
