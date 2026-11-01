import { makeStorage } from '@runlith/layer/testing';
import { describe, expect, test } from 'vitest';
import { DraftStore, type StoredDraft } from './DraftStore.js';

const row = { provider: 'a', model: 'm', reasoning: 'high' };
const team = (spend: number) => ({
  models: [
    { ...row, spend },
    { provider: 'a', on: false },
  ],
  review: { reviewers: 1, lenses: [] },
});
const draft = (spend: number) => ({ at: 1, name: 'n', text: 't', spendSteps: 10, team: team(spend) });

describe('a draft’s own sub-agent team', () => {
  test('a draft saved before spend had ten steps reads its spend on the ten-step scale; one saved after reads as written', () => {
    const storage = makeStorage();
    storage.setItem('tagma.draft.old', JSON.stringify({ ...draft(4), spendSteps: undefined }));
    const store = new DraftStore(storage, () => true);
    store.write('new', { ...store.read('old')!, team: team(4) as StoredDraft['team'] });

    expect(store.read('old')?.team?.models).toEqual([
      { ...row, spend: 8 },
      { provider: 'a', on: false },
    ]);
    expect(store.read('new')?.team?.models).toEqual([
      { ...row, spend: 4 },
      { provider: 'a', on: false },
    ]);
  });

  test('a draft saved with an ordered reviewer pool reads it as its rows marked for review, and a same-brief split as no lenses', () => {
    const storage = makeStorage();
    const pooled = { ...team(4), review: { reviewers: 2, pool: [row], split: 'same', lenses: ['tests'] } };
    storage.setItem('tagma.draft.pooled', JSON.stringify({ ...draft(4), team: pooled }));

    expect(new DraftStore(storage, () => true).read('pooled')?.team).toEqual({
      models: [
        { ...row, spend: 4 },
        { provider: 'a', on: false },
        { ...row, reviews: true },
      ],
      review: { reviewers: 2, lenses: [] },
    });
  });
});
