import { isAbsolute, relative, resolve, sep } from 'node:path';

export function workspaceTarget(cwd: string, candidate: string | undefined): string {
  return candidate ? resolve(isAbsolute(candidate) ? candidate : resolve(cwd, candidate)) : resolve(cwd);
}

export function workspaceKey(root: string, path: string): string {
  return workspaceTarget(root, path);
}

function inside(rel: string): boolean {
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function isWithin(places: readonly string[], name: string): boolean {
  return places.some((place) => inside(relative(place, name)));
}

const folds = relative('/A', '/a') === '';

const keyOf = (name: string): string => (folds ? name.toLowerCase() : name);

export function within(places: readonly string[], root: string): (name: string) => boolean {
  const fences: string[] = [];
  for (const place of places) {
    const at = resolve(root, place);
    if (inside(relative(at, root))) return () => true;
    const fence = relative(root, at);
    if (inside(fence)) fences.push(keyOf(fence));
  }
  return (name) => {
    const key = keyOf(name);
    return fences.some((fence) => key === fence || key.startsWith(`${fence}${sep}`));
  };
}
