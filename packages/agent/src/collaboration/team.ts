import type { ModelCatalog } from '@runlith/llm/models/catalog';
import { TEAM_WORK } from '@runlith/llm/models/description';
import { Schema } from 'effect';

export const REVIEW_LENSES = ['correctness', 'architecture', 'performance', 'tests', 'security', 'ux'] as const;
export type ReviewLens = (typeof REVIEW_LENSES)[number];

export const REVIEWERS_MAX = 1 + REVIEW_LENSES.length;

export const NOTE_WORDS = 6;

const Name = Schema.String.check(Schema.isMinLength(1));
const Rating = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 }));
const Spend = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 }));
const Favor = Schema.Int.check(Schema.isBetween({ minimum: -5, maximum: 5 }));
const Work = Schema.Array(Schema.Literals(TEAM_WORK));
const Note = Schema.String.check(
  Schema.makeFilter((text: string) => text.trim().split(/\s+/u).length <= NOTE_WORDS || `a note holds at most ${NOTE_WORDS} words`),
);

export const TeamModelKey = Schema.Struct({ provider: Name, model: Name, reasoning: Schema.NullOr(Name) });
export type TeamModelKey = typeof TeamModelKey.Type;

export const TeamModelEdit = Schema.Struct({
  ...TeamModelKey.fields,
  open: Schema.optionalKey(Rating),
  depth: Schema.optionalKey(Rating),
  taste: Schema.optionalKey(Rating),
  ui: Schema.optionalKey(Rating),
  spend: Schema.optionalKey(Spend),
  favor: Schema.optionalKey(Favor),
  only: Schema.optionalKey(Work),
  not: Schema.optionalKey(Work),
  note: Schema.optionalKey(Schema.NullOr(Note)),
  operatorOnly: Schema.optionalKey(Schema.Boolean),
  on: Schema.optionalKey(Schema.Boolean),
  reviews: Schema.optionalKey(Schema.Boolean),
  removed: Schema.optionalKey(Schema.Boolean),
});
export type TeamModelEdit = typeof TeamModelEdit.Type;

export const TeamProviderEdit = Schema.Struct({ provider: Name, on: Schema.Boolean });
export type TeamProviderEdit = typeof TeamProviderEdit.Type;

export const TeamEdit = Schema.Union([TeamModelEdit, TeamProviderEdit]);
export type TeamEdit = typeof TeamEdit.Type;

export const ReviewPolicy = Schema.Struct({
  reviewers: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: REVIEWERS_MAX })),
  lenses: Schema.Array(Schema.Literals(REVIEW_LENSES)),
});
export type ReviewPolicy = typeof ReviewPolicy.Type;

export const NO_REVIEW: ReviewPolicy = { reviewers: 1, lenses: [] };

export const TeamLayer = Schema.Struct({ models: Schema.Array(TeamEdit), review: ReviewPolicy });
export type TeamLayer = typeof TeamLayer.Type;

const ShippedRating = Schema.Struct({
  open: Rating,
  depth: Rating,
  taste: Rating,
  ui: Rating,
  spend: Spend,
  only: Work,
  not: Work,
  note: Schema.NullOr(Schema.String),
  operatorOnly: Schema.Boolean,
});
type ShippedRating = typeof ShippedRating.Type;

export const TeamModel = Schema.Struct({
  ...TeamModelKey.fields,
  ...ShippedRating.fields,
  favor: Favor,
  on: Schema.Boolean,
  reviews: Schema.Boolean,
  shipped: Schema.NullOr(ShippedRating),
});
export type TeamModel = typeof TeamModel.Type;

export const Team = Schema.Struct({ models: Schema.Array(TeamModel), off: Schema.Array(Name), review: ReviewPolicy });
export type Team = typeof Team.Type;

export type TeamSources = {
  readonly catalog: ModelCatalog;
  readonly connected: ReadonlySet<string>;
  readonly edits: readonly TeamEdit[];
  readonly review: ReviewPolicy;
};

const keyOf = (row: TeamModelKey): string => JSON.stringify([row.provider, row.model, row.reasoning]);

const UNRATED = {
  open: 5,
  depth: 5,
  taste: 5,
  ui: 5,
  spend: 5,
  favor: 0,
  only: [],
  not: [],
  note: null,
  operatorOnly: false,
  on: true,
  reviews: false,
  shipped: null,
} as const;

const MARKS: ReadonlySet<string> = new Set(['provider', 'model', 'reasoning', 'reviews']);

const served = (catalog: ModelCatalog, row: TeamModelKey): boolean => {
  const option = catalog.modelsFor(row.provider, 'text').find((candidate) => candidate.id === row.model);
  if (option === undefined) return false;
  return row.reasoning === null ? option.reasoningOptions.length === 0 : option.reasoningOptions.some((rung) => rung.id === row.reasoning);
};

export function teamOf({ catalog, connected, edits, review }: TeamSources): Team {
  const rows = new Map<string, TeamModel>();
  for (const provider of catalog.providers) {
    if (!connected.has(provider.id)) continue;
    for (const rating of provider.team ?? []) {
      const shipped: ShippedRating = {
        open: rating.open,
        depth: rating.depth,
        taste: rating.taste,
        ui: rating.ui,
        spend: rating.spend,
        only: rating.only ?? [],
        not: rating.not ?? [],
        note: rating.note ?? null,
        operatorOnly: rating.operatorOnly === true,
      };
      const row: TeamModel = {
        provider: provider.id,
        model: rating.model,
        reasoning: rating.reasoning,
        ...shipped,
        favor: 0,
        on: false,
        reviews: false,
        shipped,
      };
      rows.set(keyOf(row), row);
    }
  }
  const off = new Set<string>();
  for (const edit of edits) {
    if (!('model' in edit)) {
      if (edit.on) off.delete(edit.provider);
      else off.add(edit.provider);
      continue;
    }
    const { removed, ...fields } = edit;
    const key = keyOf(fields);
    const row = rows.get(key);
    if (removed === true) rows.delete(key);
    else if (row !== undefined || Object.keys(fields).some((field) => !MARKS.has(field))) rows.set(key, { ...UNRATED, ...row, ...fields });
  }
  const models = [...rows.values()].filter((row) => connected.has(row.provider) && served(catalog, row));
  return { models, off: [...off].filter((provider) => models.some((row) => row.provider === provider)), review };
}

export const teamModelWords = (row: TeamModelKey): string =>
  `${row.provider}/${row.model}${row.reasoning === null ? '' : ` ${row.reasoning}`}`;

const standing = (team: Team, row: TeamModel): boolean => !team.off.includes(row.provider);

export const enabledModels = (team: Team): readonly TeamModel[] => team.models.filter((row) => row.on && standing(team, row));

export const listedModels = (team: Team): readonly TeamModel[] =>
  team.models.filter((row) => (row.on || row.reviews) && standing(team, row));

export const reviewers = (team: Team): readonly TeamModel[] =>
  team.review.reviewers === 0 ? [] : team.models.filter((row) => row.reviews && standing(team, row));

export function rowWords(row: TeamModel): string {
  const limits = [
    ...(row.only.length === 0 ? [] : [`only ${row.only.join(', ')}`]),
    ...(row.not.length === 0 ? [] : [`not ${row.not.join(', ')}`]),
    ...(row.note === null ? [] : [row.note]),
    ...(row.operatorOnly ? ['operator-only'] : []),
    ...(row.reviews ? [row.on ? 'reviews' : 'review only'] : []),
  ];
  const favor = row.favor === 0 ? '' : `, favor ${row.favor > 0 ? '+' : ''}${row.favor}`;
  const ratings = `open ${row.open}, depth ${row.depth}, taste ${row.taste}, ui ${row.ui}, spend ${row.spend}${favor}`;
  return `${teamModelWords(row)} — ${[ratings, ...limits].join('; ')}`;
}

export function modelChoiceWords(team: Team): string {
  const listed = listedModels(team);
  if (listed.length === 0)
    return 'Omit it: the child inherits yours. No model is chosen for sub-agents; name one only when the operator names it in the conversation.';
  return [
    'A model id; absent, the child inherits yours. Rate the task 1–10 on open (how much it decides itself instead of following a given design), depth (hidden causes, races, invariants, optimization), taste (structure, names, boundaries, readability) and ui (what a person sees: the interface and its words); take the row meeting every need with the lowest spend minus favor. Favor is the operator’s wish to see a row taken more (+) or less (−) often, never a cost. `only` and `not` bind; a reviewer runs on a row marked `reviews` or `review only`, chosen for the work it reads by the same rule, and a `review only` row starts nothing else; an operator-only row runs only on the operator’s word; a model the operator named in the conversation wins over the list. Pass the row’s provider, model and reasoning.',
    ...listed.map(rowWords),
  ].join('\n');
}

export function reviewWords(team: Team): string {
  if (reviewers(team).length === 0) return 'Review: none — start no reviewer.';
  const { reviewers: count, lenses } = team.review;
  const who = count === 1 ? 'at most one reviewer' : `up to ${count} reviewers, as many as the change needs`;
  const how =
    count === 1
      ? []
      : [
          lenses.length === 0
            ? 'each reads the same brief in isolation'
            : `the first reads the whole work, each next one a lens: ${lenses.join(', ')}`,
        ];
  return `Review of a delivered change: ${[`${who} on spawn_agent.model rows marked for review, chosen by their ratings for the work`, 'skip one whose account is exhausted', ...how].join('; ')}.`;
}

export function teamModelsWords(team: Team): string {
  const listed = listedModels(team);
  return listed.length === 0
    ? 'Sub-agent models: none listed — omit `model` and the child inherits yours.'
    : `Sub-agent models for spawn_agent.model now: ${listed.map(rowWords).join('; ')}.`;
}
