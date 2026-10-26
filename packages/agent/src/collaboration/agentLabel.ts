import type { ModelCatalog } from '@runlith/llm/models/catalog';

export function threadAgentLabel(agent: { readonly threadId: string; readonly name: string | null }, detail?: string | null): string {
  const address = agent.name ?? agent.threadId;
  return detail === undefined || detail === null || detail.length === 0 ? address : `${address} · ${detail}`;
}

const NAMED_RECIPIENTS = 3;

export function recipientsTitle(names: readonly string[]): string {
  const named = names.slice(0, NAMED_RECIPIENTS).join(', ');
  return names.length > NAMED_RECIPIENTS ? `${named} +${names.length - NAMED_RECIPIENTS}` : named;
}

export type ModelNaming = {
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly reasoning?: string | null;
};

export function modelName(catalog: ModelCatalog, selection: ModelNaming): string | undefined {
  const { provider, model, reasoning } = selection;
  const option =
    model === undefined || model === null
      ? undefined
      : catalog.options.find((entry) => entry.id === model && (provider === undefined || provider === null || entry.provider === provider));
  const named = option?.label ?? model ?? undefined;
  const rung =
    reasoning === undefined || reasoning === null
      ? undefined
      : (option?.reasoningOptions.find((entry) => entry.id === reasoning)?.label ?? reasoning);
  const parts = [named, rung].filter((part): part is string => part !== undefined && part.length > 0);
  return parts.length === 0 ? undefined : parts.join(' · ');
}
