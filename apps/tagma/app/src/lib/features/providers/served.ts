import type { ServedProvider } from '@tagma/server/providers/contract/wire/catalog';
import type { ModelCatalog } from '@runlith/llm/models/catalog';

export type ServedModels = ModelCatalog<ServedProvider>;

export function providerName(models: ServedModels, provider: string): string {
  return models.registered(provider) ? (models.named(provider).accountsLabel ?? models.providerLabel(provider)) : provider;
}

export function billedLabel(models: ServedModels, provider: string, label: string): string {
  if (!models.registered(provider)) return label;
  return `${label} · ${models.named(provider).auth === 'api-key' ? 'API key' : 'plan'}`;
}

export function accountSourceOf(models: ServedModels, provider: string): string {
  return models.registered(provider) ? models.named(provider).accountSource : provider;
}

export function signsIn(models: ServedModels, provider: string): boolean {
  return (
    models.registered(provider) &&
    (models.named(provider).auth !== 'api-key' || models.named(provider).kind === 'harness') &&
    models.named(provider).signInMethods.length > 0
  );
}
