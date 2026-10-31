import { describe, expect, test } from 'bun:test';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import { modelCatalog } from '@runlith/llm/models/catalog';
import type { ProviderDescription, TeamRating } from '@runlith/llm/models/description';
import { enabledModels, listedModels, NO_REVIEW, reviewers, teamModelsWords, teamOf, type TeamEdit } from './team';

const provider = (id: string, team: readonly TeamRating[]): ProviderDescription => ({
  id,
  label: id,
  auth: 'oauth',
  models: {
    deep: { label: 'Deep', capacity: { context: 100_000 }, capabilities: ['text'], reasoning: ['high', 'xhigh'], defaultReasoning: 'high' },
    quick: { label: 'Quick', capacity: { context: 100_000 }, capabilities: ['text'], reasoning: [], defaultReasoning: null },
  },
  cacheLifetime: { promisedSeconds: null, prior: null },
  defaultTextModel: 'deep',
  team,
});

const rated = (model: string, reasoning: string | null, open: number): TeamRating => ({
  model,
  reasoning,
  open,
  depth: 6,
  taste: 6,
  ui: 6,
  spend: 3,
});

const shipped = [rated('deep', 'high', 7), rated('deep', 'xhigh', 9), rated('deep', 'max', 9)];
const catalog = (open: number) =>
  modelCatalog([provider('alpha', [rated('deep', 'high', open), ...shipped.slice(1)]), provider('beta', shipped)]);
const words = (rows: readonly { provider: string; model: string; reasoning: string | null }[]) =>
  rows.map((row) => `${row.provider}/${row.model}/${row.reasoning}`);

describe('teamOf', () => {
  test('each connected provider brings its shipped rows the catalog serves, none of them chosen; a disconnected one brings none', () => {
    const one = (connected: readonly string[]) =>
      teamOf({ catalog: catalog(7), connected: new Set(connected), edits: [], review: NO_REVIEW });
    expect(words(one(['beta']).models)).toEqual(['beta/deep/high', 'beta/deep/xhigh']);
    const both = one(['alpha', 'beta']);
    expect(words(both.models)).toEqual(['alpha/deep/high', 'alpha/deep/xhigh', 'beta/deep/high', 'beta/deep/xhigh']);
    expect(enabledModels(both)).toEqual([]);
  });

  test('edits apply in layer order over shipped values, and a shipped update reaches every field no edit set', () => {
    const edits: readonly TeamEdit[] = [
      { provider: 'alpha', model: 'deep', reasoning: 'high', depth: 2 },
      { provider: 'alpha', model: 'deep', reasoning: 'high', depth: 4, on: false },
      { provider: 'alpha', model: 'deep', reasoning: 'xhigh', removed: true },
      { provider: 'alpha', model: 'quick', reasoning: null, spend: 1 },
    ];
    const before = teamOf({ catalog: catalog(7), connected: new Set(['alpha']), edits, review: NO_REVIEW });
    const after = teamOf({ catalog: catalog(8), connected: new Set(['alpha']), edits, review: NO_REVIEW });
    expect(before.models.map((row) => [row.model, row.reasoning, row.open, row.depth, row.spend, row.on, row.shipped !== null])).toEqual([
      ['deep', 'high', 7, 4, 3, false, true],
      ['quick', null, 5, 5, 1, true, false],
    ]);
    expect(after.models[0]).toMatchObject({ open: 8, depth: 4 });
  });

  test('agents read spend as rated and a non-zero favor as its own field beside it', () => {
    const team = teamOf({
      catalog: catalog(7),
      connected: new Set(['alpha']),
      edits: [
        { provider: 'alpha', model: 'deep', reasoning: 'high', on: true, spend: 6, favor: 2 },
        { provider: 'alpha', model: 'deep', reasoning: 'xhigh', on: true, favor: -1 },
        { provider: 'alpha', model: 'quick', reasoning: null, spend: 1 },
      ],
      review: NO_REVIEW,
    });
    const read = [...teamModelsWords(team).matchAll(/alpha\/(\w+)(?: (\w+))? — [^;]*spend (\d+)(?:, favor ([+-]\d+))?/g)].map((hit) => [
      hit[2] ?? null,
      Number(hit[3]),
      hit[4] ?? null,
    ]);
    expect(read).toEqual([
      ['high', 6, '+2'],
      ['xhigh', 3, '-1'],
      [null, 1, null],
    ]);
  });

  test('reviewers come from rows marked for review, none at a count of 0, and a provider switched off takes its rows out of both while each keeps its own marks', () => {
    const edits: readonly TeamEdit[] = [
      { provider: 'alpha', model: 'deep', reasoning: 'high', on: true },
      { provider: 'alpha', model: 'deep', reasoning: 'xhigh', reviews: true },
    ];
    const team = teamOf({ catalog: catalog(7), connected: new Set(['alpha']), edits, review: NO_REVIEW });
    expect(words(enabledModels(team))).toEqual(['alpha/deep/high']);
    expect(words(listedModels(team))).toEqual(['alpha/deep/high', 'alpha/deep/xhigh']);
    expect(words(reviewers(team))).toEqual(['alpha/deep/xhigh']);
    expect(reviewers({ ...team, review: { ...team.review, reviewers: 0 } })).toEqual([]);
    const off = teamOf({
      catalog: catalog(7),
      connected: new Set(['alpha']),
      edits: [...edits, { provider: 'alpha', on: false }],
      review: NO_REVIEW,
    });
    expect(off.models.map((row) => [row.on, row.reviews])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect([...listedModels(off), ...reviewers(off)]).toEqual([]);
  });

  test('every route to Claude and OpenAI brings Tagma’s ratings, each for a rung some route serves, none chosen for work or review', () => {
    const routes = ['anthropic', 'claude-code', 'openai', 'openai-oauth', 'codex'];
    const team = teamOf({ catalog: modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS), connected: new Set(routes), edits: [], review: NO_REVIEW });
    expect(routes.filter((route) => !team.models.some((row) => row.provider === route))).toEqual([]);
    expect(team.models.filter((row) => row.on || row.reviews || row.shipped === null)).toEqual([]);
    const rated = new Set(team.models.map((row) => `${row.model} ${row.reasoning}`));
    const declared = DEFAULT_PROVIDER_DESCRIPTIONS.filter((provider) => routes.includes(provider.id)).flatMap(
      (provider) => provider.team ?? [],
    );
    expect(declared.map((rating) => `${rating.model} ${rating.reasoning}`).filter((rung) => !rated.has(rung))).toEqual([]);
  });

  test('a mark for review alone marks a standing row and brings back no removed or absent one', () => {
    const team = teamOf({
      catalog: catalog(7),
      connected: new Set(['alpha']),
      edits: [
        { provider: 'alpha', model: 'deep', reasoning: 'xhigh', removed: true },
        { provider: 'alpha', model: 'deep', reasoning: 'xhigh', reviews: true },
        { provider: 'alpha', model: 'quick', reasoning: null, reviews: true },
        { provider: 'alpha', model: 'deep', reasoning: 'high', reviews: true },
      ],
      review: NO_REVIEW,
    });
    expect(team.models.map((row) => [row.model, row.reasoning, row.on, row.reviews])).toEqual([['deep', 'high', false, true]]);
  });
});
