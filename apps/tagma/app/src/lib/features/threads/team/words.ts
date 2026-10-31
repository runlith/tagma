import { TEAM_WORK } from '@runlith/llm/models/description';
import {
  enabledModels,
  REVIEW_LENSES,
  reviewers,
  type ReviewLens,
  type Team,
  type TeamModel,
  type TeamModelKey,
} from '@runlith/agent/collaboration/team';
import type { ServedModels } from '$lib/features/providers/served.js';
import type { ModelStep } from '$lib/shared/models/choice.js';

export type RowName = { readonly label: string; readonly short: string; readonly rung: string | null };

export type ModelLine<Row extends TeamModelKey> = {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly { readonly step: ModelStep | null; readonly row: Row }[];
};

export const AXES = [
  { field: 'open', label: 'Open', hint: 'How much it decides itself: 1 follows a given design, 10 invents one' },
  { field: 'depth', label: 'Depth', hint: 'How it holds on hard problems: hidden causes, races, invariants' },
  { field: 'taste', label: 'Taste', hint: 'Its code: structure, names, boundaries, readability' },
  { field: 'ui', label: 'UI', hint: 'What a person sees: the interface and its words' },
  { field: 'spend', label: 'Spend', hint: 'What one task costs you in quota or money: 1 the cheapest' },
] as const;

const LENS_WORDS: Record<ReviewLens, string> = {
  correctness: 'Correctness',
  architecture: 'Architecture',
  performance: 'Performance',
  tests: 'Tests',
  security: 'Security',
  ux: 'UX',
};

export const LENS_CHOICES = REVIEW_LENSES.map((lens) => ({ value: lens, label: LENS_WORDS[lens] }));

export const WORK_CHOICES = TEAM_WORK.map((work) => ({ value: work, label: work }));

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

export function reviewWords(team: Team): string {
  if (reviewers(team).length === 0) return 'Nobody';
  return team.review.reviewers === 1 ? '1 reviewer' : `Up to ${team.review.reviewers}`;
}

export const signedWords = (value: number): string => (value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '0');

export const favorWords = (favor: number): string => (favor > 0 ? 'more often' : favor < 0 ? 'less often' : 'as rated');

export function limitWords(row: TeamModel): readonly string[] {
  return [
    ...(row.only.length === 0 ? [] : [`only ${row.only.join(', ')}`]),
    ...(row.not.length === 0 ? [] : [`never ${row.not.join(', ')}`]),
    ...(row.operatorOnly ? ['on your word'] : []),
  ];
}
