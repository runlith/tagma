import { UnsupportedSource } from '@runlith/code-facts/imports';
import { type LanguageId, LANGUAGES } from '@runlith/code-facts/languages';
import type { Tree } from '@runlith/code-facts/tree';
import type { ProjectFacts } from '../rule';

const MANIFEST = 'package.json';

const DEPENDENCIES = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

const LANGUAGE_BY_EXTENSION: ReadonlyMap<string, LanguageId> = new Map(
  LANGUAGES.flatMap(({ id, extensions }) => extensions.map((extension) => [extension, id] as const)),
);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const namedBy = (path: string, text: string): readonly string[] => {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new UnsupportedSource(path, 'its manifest is not JSON');
  }
  if (!isObject(manifest)) throw new UnsupportedSource(path, 'its manifest is not a JSON object');
  const named = typeof manifest.name === 'string' ? [manifest.name] : [];
  for (const field of DEPENDENCIES) {
    const held = manifest[field];
    if (held === undefined) continue;
    if (!isObject(held)) throw new UnsupportedSource(path, `its manifest's \`${field}\` is not an object`);
    named.push(...Object.keys(held));
  }
  return named;
};

const languageOf = (path: string): LanguageId | undefined => {
  const dot = path.lastIndexOf('.');
  return dot > path.lastIndexOf('/') ? LANGUAGE_BY_EXTENSION.get(path.slice(dot)) : undefined;
};

export const projectFacts = (tree: Tree): ProjectFacts => {
  if (tree.paths === undefined) throw new UnsupportedSource('', 'the tree lists no paths, so the packs it uses cannot be told');
  const languages = new Set<LanguageId>();
  const packages = new Set<string>();
  for (const path of tree.paths()) {
    const language = languageOf(path);
    if (language !== undefined) languages.add(language);
    if (path === MANIFEST || path.endsWith(`/${MANIFEST}`)) for (const name of namedBy(path, tree.read(path))) packages.add(name);
  }
  return { languages, packages };
};
