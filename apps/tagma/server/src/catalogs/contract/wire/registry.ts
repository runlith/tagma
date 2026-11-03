import { coreLibrary } from './coreLibrary.js';
import { knowledge } from './knowledge.js';
import { softwareDevelopment } from './softwareDevelopment.js';
import { work } from './work.js';
import { type Catalog, composedCatalogs, type Tag } from '../../../graph/contract/wire/tags/declaration.js';

export const CATALOGS: readonly Catalog[] = [coreLibrary, work, softwareDevelopment, knowledge];

export const CATALOG_IDS: readonly string[] = CATALOGS.map((catalog) => catalog.id);

export const DEFAULT_CATALOGS: readonly string[] = [coreLibrary.id, work.id, softwareDevelopment.id];

export function catalogById(id: string): Catalog | null {
  return CATALOGS.find((catalog) => catalog.id === id) ?? null;
}

export function catalogsDeclaring(tagId: string): string[] {
  return CATALOGS.flatMap((catalog) => (catalog.tags.some((tag) => tag.id === tagId) ? [catalog.id] : []));
}

export function tagsOfCatalogs(ids: readonly string[]): Tag[] {
  const wanted = new Set<string>();
  const add = (id: string): void => {
    if (wanted.has(id)) return;
    wanted.add(id);
    for (const required of catalogById(id)?.requires ?? []) add(required);
  };
  for (const id of ids) add(id);
  return composedCatalogs(CATALOGS.filter((catalog) => wanted.has(catalog.id))).flatMap((catalog) => [...catalog.tags]);
}
