import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Schema } from 'effect';

export const tagmaSection = Schema.Struct({
  host: Schema.optional(Schema.Array(Schema.String)),
  build: Schema.optional(Schema.Literal('developer')),
  labels: Schema.optional(Schema.Array(Schema.NonEmptyString)),
});

const manifestSchema = Schema.Struct({ name: Schema.String, tagma: Schema.optional(tagmaSection) });
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(manifestSchema));
const decodeSection = Schema.decodeUnknownSync(Schema.Struct({ tagma: Schema.optional(tagmaSection) }));

export const hostSpecifiers = (manifests: readonly string[]): readonly string[] =>
  manifests
    .flatMap((text) => {
      const manifest = decode(text);
      return (manifest.tagma?.host ?? []).map((entry) => (entry.startsWith('./') ? `${manifest.name}${entry.slice(1)}` : entry));
    })
    .sort();

const absent = (error: NodeJS.ErrnoException): null => {
  if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
  throw error;
};

const MANIFESTS = ['module.json', 'package.json'] as const;

export type DeveloperMark = { readonly manifest: string } | null;

const markAt = async (directory: string): Promise<DeveloperMark> => {
  for (const name of MANIFESTS) {
    const path = join(directory, name);
    const text = await readFile(path, 'utf8').catch(absent);
    if (text === null) continue;
    const section = JSON.parse(text) as { readonly tagma?: unknown };
    if (decodeSection({ tagma: section.tagma }).tagma?.build === 'developer') return { manifest: path };
  }
  return null;
};

export const developerMarks = (): ((path: string) => Promise<DeveloperMark>) => {
  const held = new Map<string, Promise<DeveloperMark>>();
  const nearest = (directory: string): Promise<DeveloperMark> => {
    const known = held.get(directory);
    if (known !== undefined) return known;
    const read = markAt(directory).then((found): DeveloperMark | Promise<DeveloperMark> => {
      if (found !== null) return found;
      const parent = dirname(directory);
      return parent === directory ? null : nearest(parent);
    });
    held.set(directory, read);
    return read;
  };
  return (path) => nearest(dirname(path));
};

export type DeclaredLabels = { readonly manifest: string; readonly labels: readonly string[] };

export const developerLabels = async (manifests: readonly string[]): Promise<readonly DeclaredLabels[]> => {
  const declared: DeclaredLabels[] = [];
  for (const manifest of manifests) {
    const text = await readFile(manifest, 'utf8').catch(absent);
    if (text === null) continue;
    const section = decodeSection({ tagma: (JSON.parse(text) as { readonly tagma?: unknown }).tagma }).tagma;
    if (section?.build === 'developer' && section.labels !== undefined) declared.push({ manifest, labels: section.labels });
  }
  return declared;
};

export const workspaceManifests = async (root: string): Promise<readonly string[]> => {
  const packages = join(root, 'packages');
  const names = await readdir(packages);
  const texts = await Promise.all(names.map((name) => readFile(join(packages, name, 'package.json'), 'utf8').catch(absent)));
  return texts.filter((text): text is string => text !== null);
};
