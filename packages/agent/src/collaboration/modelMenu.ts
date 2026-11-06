import { textMenu, type MenuModel, type MenuProvider, type ModelCatalog } from '@runlith/llm/models/catalog';

function operatorOnlyWords(model: MenuModel): string | null {
  if (!model.operatorOnly) return null;
  const lowered = model.lowered.map((one) => `\`${one.rung}\` lowers to \`${one.to ?? 'none'}\``);
  return ['operator-only', ...lowered].join(', ');
}

function providerLine(provider: MenuProvider): string {
  const ladders = new Map<string, string[]>();
  const marked: string[] = [];
  for (const model of provider.models) {
    const ladder = model.reasoning.join('/') || 'none';
    const note = operatorOnlyWords(model);
    if (note === null) ladders.set(ladder, [...(ladders.get(ladder) ?? []), model.id]);
    else marked.push(`${model.id} (reasoning ${ladder}) — ${note}`);
  }
  const plain = [...ladders].map(([ladder, ids]) => `${ids.join(', ')} (reasoning ${ladder})`);
  return `${provider.id}: ${[...plain, ...marked].join('; ')}`;
}

function switchLines(menu: readonly MenuProvider[]): readonly string[] {
  const offered = new Map<string, Map<string, string[]>>();
  for (const provider of menu) {
    for (const model of provider.models) {
      for (const declared of model.switches) {
        const words = `${declared.id} (${declared.values.map((value) => `${value.id} ${value.label}`).join(' | ')})`;
        const providers = offered.get(words) ?? new Map<string, string[]>();
        providers.set(provider.id, [...(providers.get(provider.id) ?? []), model.id]);
        offered.set(words, providers);
      }
    }
  }
  return [...offered].map(
    ([words, providers]) => `${words}: ${[...providers].map(([provider, ids]) => `${provider} ${ids.join(', ')}`).join('; ')}`,
  );
}

export function modelMenu(offered: ModelCatalog): string {
  const menu = textMenu(offered);
  const switches = switchLines(menu);
  return [
    'Models the installed providers offer, by provider, with the reasoning ladder each offers; a row of the sub-agent list (`agent.models`) names one with a rung:',
    ...menu.map(providerLine),
    ...(switches.length === 0 ? [] : ['', 'Switches, with their values and the models that offer them:', ...switches]),
  ].join('\n');
}
