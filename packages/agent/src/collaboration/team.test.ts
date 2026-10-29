import { describe, expect, test } from 'bun:test';
import { modelCatalog } from '@runlith/llm/models/catalog';
import type { ProviderDescription, TeamRating } from '@runlith/llm/models/description';
import { enabledModels, NO_REVIEW, reviewers, teamModelsWords, teamOf, type TeamEdit } from './team';

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
    expect(before.models.map((row) => [row.model, row.reasoning, row.open, row.depth, row.spend, row.on, row.shipped])).toEqual([
      ['deep', 'high', 7, 4, 3, false, true],
      ['quick', null, 5, 5, 1, true, false],
    ]);
    expect(after.models[0]).toMatchObject({ open: 8, depth: 4 });
  });

  test('agents compare spend minus favor, and the row keeps both as set', () => {
    const team = teamOf({
      catalog: catalog(7),
      connected: new Set(['alpha']),
      edits: [
        { provider: 'alpha', model: 'deep', reasoning: 'high', on: true, spend: 6, favor: 2 },
        { provider: 'alpha', model: 'deep', reasoning: 'xhigh', on: true, favor: -1 },
      ],
      review: NO_REVIEW,
    });
    expect(team.models.map((row) => [row.spend, row.favor])).toEqual([
      [6, 2],
      [3, -1],
    ]);
    const compared = [...teamModelsWords(team).matchAll(/alpha\/deep (\w+) — [^;]*spend (-?\d+)/g)].map((hit) => [hit[1], Number(hit[2])]);
    expect(compared).toEqual([
      ['high', 4],
      ['xhigh', 4],
    ]);
  });

  test('a provider switched off disables its rows, keeps their own on, and leaves them in the reviewer pool', () => {
    const team = teamOf({
      catalog: catalog(7),
      connected: new Set(['alpha']),
      edits: [
        { provider: 'alpha', model: 'deep', reasoning: 'high', on: true },
        { provider: 'alpha', on: false },
      ],
      review: { ...NO_REVIEW, pool: [{ provider: 'alpha', model: 'deep', reasoning: 'xhigh' }] },
    });
    expect(team.models.map((row) => row.on)).toEqual([true, false]);
    expect(enabledModels(team)).toEqual([]);
    expect(words(reviewers(team))).toEqual(['alpha/deep/xhigh']);
    expect(reviewers({ ...team, review: { ...team.review, reviewers: 0 } })).toEqual([]);
  });
});
