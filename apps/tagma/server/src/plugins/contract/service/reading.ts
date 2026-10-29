import { isAbsolute, join, relative, resolve } from 'node:path';
import { Context, Effect, FileSystem } from 'effect';
import { type PluginIgnored, type PluginSkillFile, PluginUnreadable } from './format.js';

export type PluginEntry = { readonly kind: 'absent' | 'outside' | 'file' | 'directory' | 'other'; readonly path: string };

export type Frontmatter = { readonly fields: Readonly<Record<string, unknown>>; readonly body: string };

export const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const within = (root: string, path: string): boolean => {
  const step = relative(root, path);
  return step === '' || (!step.startsWith('..') && !isAbsolute(step));
};

const unreadable = (path: string) => (failure: { readonly message: string }) => new PluginUnreadable({ path, reason: failure.message });

export const PluginReads = Context.Reference<Set<string> | null>('tagma/plugins/PluginReads', { defaultValue: () => null });

const read = (path: string) => Effect.map(PluginReads, (reads) => void reads?.add(path));

export const entryOf = Effect.fnUntraced(function* (root: string, path: string) {
  const files = yield* FileSystem.FileSystem;
  const asked = resolve(root, path);
  if (!within(root, asked)) return { kind: 'outside', path: asked } as PluginEntry;
  yield* read(asked);
  if (!(yield* files.exists(asked).pipe(Effect.mapError(unreadable(asked))))) return { kind: 'absent', path: asked } as PluginEntry;
  const real = yield* files.realPath(asked).pipe(Effect.mapError(unreadable(asked)));
  if (!within(yield* files.realPath(root).pipe(Effect.mapError(unreadable(root))), real))
    return { kind: 'outside', path: asked } as PluginEntry;
  const info = yield* files.stat(real).pipe(Effect.mapError(unreadable(asked)));
  return { kind: info.type === 'File' ? 'file' : info.type === 'Directory' ? 'directory' : 'other', path: asked } as PluginEntry;
});

export const declaredPath = Effect.fnUntraced(function* (
  root: string,
  component: string,
  path: string,
  ignored: PluginIgnored[],
  allowRoot = false,
) {
  if (!path.startsWith('./') && !(allowRoot && path === '.')) {
    ignored.push({ component, name: path, reason: 'a manifest path starts with ./' });
    return null;
  }
  const entry: PluginEntry = yield* entryOf(root, path);
  if (entry.kind === 'outside') ignored.push({ component, name: path, reason: 'the path escapes the plugin directory' });
  else if (entry.kind === 'absent') ignored.push({ component, name: path, reason: 'the path does not exist' });
  else return entry;
  return null;
});

export const namesIn = Effect.fnUntraced(function* (path: string) {
  const files = yield* FileSystem.FileSystem;
  yield* read(path);
  return (yield* files.readDirectory(path).pipe(Effect.mapError(unreadable(path)))).sort();
});

export const textOf = Effect.fnUntraced(function* (path: string) {
  const files = yield* FileSystem.FileSystem;
  yield* read(path);
  return yield* files.readFileString(path).pipe(Effect.mapError(unreadable(path)));
});

export const jsonOf = (text: string): { readonly value: unknown } | { readonly reason: string } => {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
};

export const frontmatterOf = (raw: string): Frontmatter | { readonly reason: string } => {
  const text = raw.replace(/^﻿/u, '');
  if (!text.startsWith('---')) return { fields: {}, body: text.trim() };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { reason: 'its frontmatter is not closed by ---' };
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text.slice(text.indexOf('\n') + 1, end));
  } catch (error) {
    return { reason: `its frontmatter is not YAML: ${error instanceof Error ? error.message : String(error)}` };
  }
  const fields = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  const after = text.indexOf('\n', end + 1);
  return { fields, body: after === -1 ? '' : text.slice(after + 1).trim() };
};

export const firstLine = (body: string): string =>
  body
    .split('\n')
    .find((line) => line.trim().length > 0)
    ?.trim() ?? '';

export const skillFolders = Effect.fnUntraced(function* (root: string, at: string, ignored: PluginIgnored[]) {
  const directory = yield* entryOf(root, at);
  if (directory.kind === 'absent') return [] as PluginSkillFile[];
  if (directory.kind !== 'directory') {
    ignored.push({ component: 'skills', name: at, reason: `${at} is not a directory inside the plugin` });
    return [] as PluginSkillFile[];
  }
  const skills: PluginSkillFile[] = [];
  for (const name of yield* namesIn(directory.path)) {
    const folder = yield* entryOf(root, join(directory.path, name));
    if (folder.kind !== 'directory') continue;
    const file = yield* entryOf(root, join(folder.path, 'SKILL.md'));
    if (file.kind === 'absent') continue;
    if (file.kind !== 'file') {
      ignored.push({ component: 'skill', name, reason: 'its SKILL.md is not a file inside the plugin' });
      continue;
    }
    skills.push({ name, directory: folder.path, file: file.path, render: (text) => text });
  }
  return skills;
});
