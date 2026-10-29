import { enabledModels, reviewers, type ReviewLens, type Team, type TeamModelKey } from '@runlith/agent/collaboration/team';
import type { ServedModels } from '$lib/features/providers/served.js';
import type { ModelStep } from '$lib/shared/models/choice.js';

export type RowName = { readonly label: string; readonly short: string; readonly rung: string | null };

export type ModelLine<Row extends TeamModelKey> = {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly { readonly step: ModelStep | null; readonly row: Row }[];
};

export const LENS_WORDS: Record<ReviewLens, string> = {
  correctness: 'Correctness',
  architecture: 'Architecture',
  performance: 'Performance',
  tests: 'Tests',
  security: 'Security',
  ux: 'UX',
};

const NAMES_SHOWN = 3;

const optionOf = (models: ServedModels, row: TeamModelKey) =>
  models.registered(row.provider) ? models.modelsOf(row.provider).find((model) => model.id === row.model) : undefined;

export function rowName(models: ServedModels, row: TeamModelKey): RowName {
  const option = optionOf(models, row);
  const rung = row.reasoning === null ? null : (option?.reasoningOptions.find((one) => one.id === row.reasoning)?.label ?? row.reasoning);
  return { label: option?.label ?? row.model, short: option?.short ?? row.model, rung };
}

export function modelLines<Row extends TeamModelKey>(models: ServedModels, rows: readonly Row[]): readonly ModelLine<Row>[] {
  const lines = new Map<
    string,
    { key: string; label: string; ladder: readonly ModelStep[]; rows: { step: ModelStep | null; row: Row }[] }
  >();
  for (const row of rows) {
    const key = JSON.stringify([row.provider, row.model]);
    const option = optionOf(models, row);
    const line = lines.get(key) ?? { key, label: option?.label ?? row.model, ladder: option?.reasoningOptions ?? [], rows: [] };
    const step =
      row.reasoning === null
        ? null
        : (line.ladder.find((one) => one.id === row.reasoning) ?? { id: row.reasoning, label: row.reasoning, short: row.reasoning });
    line.rows.push({ step, row });
    lines.set(key, line);
  }
  return [...lines.values()].map(({ key, label, ladder, rows: stepped }) => {
    const at = (step: ModelStep | null): number => (step === null ? -1 : ladder.indexOf(step));
    return { key, label, rows: stepped.toSorted((left, right) => at(left.step) - at(right.step)) };
  });
}

function names(models: ServedModels, rows: readonly TeamModelKey[]): readonly string[] {
  return [...new Set(rows.map((row) => rowName(models, row).short))];
}

export function agentsWords(models: ServedModels, team: Team): string {
  const shown = names(models, enabledModels(team));
  if (shown.length === 0) return 'Nothing';
  return shown.length <= NAMES_SHOWN ? shown.join(', ') : `${shown.length} models`;
}

export function reviewWords(models: ServedModels, team: Team): string {
  const shown = names(models, reviewers(team));
  return shown.length === 0 ? 'Nobody' : shown.slice(0, NAMES_SHOWN).join(', ');
}
