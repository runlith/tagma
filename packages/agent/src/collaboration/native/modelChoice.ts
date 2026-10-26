import type { ModelCatalog } from '@runlith/llm/models/catalog';

export function modelOf(models: ModelCatalog | null, row: { readonly provider: string; readonly model: string | null }): string | null {
  if (row.model !== null) return row.model;
  if (models === null || !models.registered(row.provider)) return null;
  return models.defaultTextModelId(row.provider);
}
