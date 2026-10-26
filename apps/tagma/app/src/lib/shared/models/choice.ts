import type { ModelSwitch, ModelSwitches } from '@runlith/llm/models/description';
import { rank, terms } from '@runlith/search-text/match';

export type ModelStep = {
  readonly id: string;
  readonly label: string;
  readonly short: string;
};

export type ModelFlag = {
  readonly text: string;
  readonly tone: 'good' | 'warn' | 'bad' | 'muted';
};

export type ModelToggle = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  readonly off: string;
  readonly on: string;
  readonly value: string | null;
};

export type ModelChoice = {
  readonly provider: string;
  readonly providerLabel: string;
  readonly model: string;
  readonly label: string;
  readonly short: string;
  readonly ladder: readonly ModelStep[];
  readonly rung: string | null;
  readonly meta?: string;
  readonly flags?: readonly ModelFlag[];
  readonly toggles?: readonly ModelToggle[];
  readonly disabled?: boolean;
};

export function togglesOf(switches: readonly ModelSwitch[], chosen: ModelSwitches): readonly ModelToggle[] {
  return switches.flatMap((one) => {
    const [off, on] = one.values;
    if (one.icon === undefined || off === undefined || on === undefined || one.values.length !== 2) return [];
    return [
      {
        id: one.id,
        label: one.label,
        description: one.description,
        icon: one.icon,
        off: off.id,
        on: on.id,
        value: chosen[one.id] ?? one.default,
      },
    ];
  });
}

export type ModelLead = {
  readonly id: string;
  readonly label: string;
  readonly starred?: boolean;
  readonly note?: string;
  readonly keys: readonly string[];
};

export type ModelGesture = 'send' | 'queue';

export function choiceKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

export function windowWord(tokens: number | undefined): string {
  if (tokens === undefined) return '';
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / 1_000)}K`;
}

export function rankChoices(choices: readonly ModelChoice[], query: string, lead: readonly string[] = []): readonly ModelChoice[] {
  if (terms(query).length === 0) return choices;
  const leadAt = new Map<string, number>();
  for (const key of lead) if (!leadAt.has(key)) leadAt.set(key, leadAt.size);
  return rank(choices, query, (choice) => ({
    name: choice.label,
    names: [choice.short, choice.model],
    text: [choice.providerLabel, choice.provider],
  }))
    .map(({ item, hit }, order) => ({
      choice: item,
      order,
      exact: hit.exact ? 0 : 1,
      led: (hit.loose ? undefined : leadAt.get(choiceKey(item.provider, item.model))) ?? leadAt.size,
    }))
    .sort((left, right) => left.exact - right.exact || left.led - right.led || left.order - right.order)
    .map((row) => row.choice);
}
