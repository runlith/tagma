import { OPERATOR_ONLY_REASONING, type ModelCatalog, type ModelOption } from '@runlith/llm/models/catalog';

function operatorOnlyWords(offered: ModelCatalog, option: ModelOption): string | null {
  if (!option.operatorOnly) return null;
  const lowered = option.reasoningOptions
    .filter((level) => OPERATOR_ONLY_REASONING.has(level.id))
    .map((level) => `\`${level.id}\` lowers to \`${offered.spawnReasoning(option, level.id, true) ?? 'none'}\``);
  return ['operator-only', ...lowered].join(', ');
}

function providerLine(offered: ModelCatalog, provider: string, text: readonly ModelOption[]): string {
  const ladders = new Map<string, string[]>();
  const marked: string[] = [];
  for (const option of text.filter((candidate) => candidate.provider === provider)) {
    const ladder = option.reasoningOptions.map((level) => level.id).join('/') || 'none';
    const note = operatorOnlyWords(offered, option);
    if (note === null) ladders.set(ladder, [...(ladders.get(ladder) ?? []), option.id]);
    else marked.push(`${option.id} (reasoning ${ladder}) — ${note}`);
  }
  const plain = [...ladders].map(([ladder, ids]) => `${ids.join(', ')} (reasoning ${ladder})`);
  return `${provider}: ${[...plain, ...marked].join('; ')}`;
}

function switchLines(text: readonly ModelOption[]): readonly string[] {
  const offered = new Map<string, Map<string, string[]>>();
  for (const option of text) {
    for (const declared of option.switches) {
      const words = `${declared.id} (${declared.values.map((value) => `${value.id} ${value.label}`).join(' | ')})`;
      const providers = offered.get(words) ?? new Map<string, string[]>();
      providers.set(option.provider, [...(providers.get(option.provider) ?? []), option.id]);
      offered.set(words, providers);
    }
  }
  return [...offered].map(
    ([words, providers]) => `${words}: ${[...providers].map(([provider, ids]) => `${provider} ${ids.join(', ')}`).join('; ')}`,
  );
}

export function modelMenu(offered: ModelCatalog): string {
  const text = offered.modelsByCapability('text');
  const providers = [...new Set(text.map((option) => option.provider))];
  const switches = switchLines(text);
  return [
    'Models the installed providers offer, by provider, with the reasoning ladder each offers; a row of the sub-agent list (`agent.models`) names one with a rung:',
    ...providers.map((provider) => providerLine(offered, provider, text)),
    ...(switches.length === 0 ? [] : ['', 'Switches, with their values and the models that offer them:', ...switches]),
  ].join('\n');
}
