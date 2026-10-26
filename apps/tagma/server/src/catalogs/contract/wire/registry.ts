import { coreLibrary } from './coreLibrary.js';
import { knowledge } from './knowledge.js';
import { softwareDevelopment } from './softwareDevelopment.js';
import type { Catalog, Tag } from '../../../graph/contract/wire/tags/declaration.js';

export const CATALOGS: readonly Catalog[] = [coreLibrary, softwareDevelopment, knowledge];

export const CATALOG_IDS: readonly string[] = CATALOGS.map((catalog) => catalog.id);

export const DEFAULT_CATALOGS: readonly string[] = [coreLibrary.id, softwareDevelopment.id];

export function catalogById(id: string): Catalog | null {
  return CATALOGS.find((catalog) => catalog.id === id) ?? null;
}

export function catalogsDeclaring(tagId: string): string[] {
  return CATALOGS.flatMap((catalog) => (catalog.tags.some((tag) => tag.id === tagId) ? [catalog.id] : []));
}

export function tagsOfCatalogs(ids: readonly string[]): Tag[] {
  return ids.flatMap((id) => [...(catalogById(id)?.tags ?? [])]);
}
