import { enabledModels, reviewers, type ReviewLens, type Team, type TeamModelKey } from '@runlith/agent/collaboration/team';
import type { ServedModels } from '$lib/features/providers/served.js';

export type RowName = { readonly label: string; readonly short: string; readonly rung: string | null };

export const LENS_WORDS: Record<ReviewLens, string> = {
  correctness: 'Correctness',
  architecture: 'Architecture',
  performance: 'Performance',
  tests: 'Tests',
  security: 'Security',
  ux: 'UX',
};

const NAMES_SHOWN = 3;

export function rowName(models: ServedModels, row: TeamModelKey): RowName {
  const option = models.registered(row.provider) ? models.modelsOf(row.provider).find((model) => model.id === row.model) : undefined;
  const rung = row.reasoning === null ? null : (option?.reasoningOptions.find((one) => one.id === row.reasoning)?.label ?? row.reasoning);
  return { label: option?.label ?? row.model, short: option?.short ?? row.model, rung };
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
