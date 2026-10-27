import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Effect, Exit, Schema } from 'effect';
import { renderWorldState, unreadable, withdrawn, worldStateSection, type WorldStateSection } from './WorldState';
const names = Schema.Array(Schema.String);
function section(read: WorldStateSection<readonly string[]>['read'], over: Partial<WorldStateSection<readonly string[]>> = {}) {
  return worldStateSection({
    id: 'skills',
    codec: names,
    read,
    baseline: (current) => `baseline: ${current.join(', ')}`,
    update: (_previous, current) => `update: ${current.join(', ')}`,
    removed: () => 'removed',
    ...over,
  });
}
describe('rendering a world state against what the model was last told', () => {
  it.effect(
    'delivers a baseline, then an update with its matching snapshot, including an unreadable prior value',
    Effect.fnUntraced(function* () {
      expect(yield* renderWorldState([section(() => ['reviewer'])], {})).toMatchObject({
        kind: 'changed',
        text: 'baseline: reviewer',
        snapshot: { skills: ['reviewer'] },
      });
      for (const prior of [['reviewer'], { shape: 'unknown' }]) {
        expect(yield* renderWorldState([section(() => ['deployer'])], { skills: prior })).toMatchObject({
          kind: 'changed',
          text: 'update: deployer',
          snapshot: { skills: ['deployer'] },
        });
      }
    }),
  );
  it.effect(
    'compares by value even when the rendering changes',
    Effect.fnUntraced(function* () {
      expect(yield* renderWorldState([section(() => ['reviewer'], { update: () => 'reworded' })], { skills: ['reviewer'] })).toEqual({
        kind: 'unchanged',
        snapshot: { skills: ['reviewer'] },
      });
    }),
  );
  it.effect(
    'keeps an unreadable section’s admitted snapshot and invents nothing on a failed first read',
    Effect.fnUntraced(function* () {
      expect(yield* renderWorldState([section(() => unreadable)], {})).toEqual({ kind: 'unchanged', snapshot: {} });
      expect(
        yield* renderWorldState([section(() => unreadable), section(() => ['other'], { id: 'files' })], { skills: ['reviewer'] }),
      ).toMatchObject({ kind: 'changed', text: 'baseline: other', snapshot: { skills: ['reviewer'], files: ['other'] } });
    }),
  );
  it.effect(
    'removes a delivered section from both the text and snapshot, but stays silent for an unseen section',
    Effect.fnUntraced(function* () {
      expect(yield* renderWorldState([section(() => withdrawn)], {})).toEqual({ kind: 'unchanged', snapshot: {} });
      expect(yield* renderWorldState([section(() => withdrawn)], { skills: ['reviewer'] })).toEqual({
        kind: 'changed',
        text: 'removed',
        content: [{ type: 'text', text: 'removed' }],
        snapshot: {},
        told: { skills: null },
      });
    }),
  );
  it.effect(
    'joins changed sections in their delivery order',
    Effect.fnUntraced(function* () {
      expect(yield* renderWorldState([section(() => ['reviewer']), section(() => ['AGENTS.md'], { id: 'files' })], {})).toMatchObject({
        kind: 'changed',
        text: 'baseline: reviewer\n\nbaseline: AGENTS.md',
      });
    }),
  );
  it.effect(
    'refuses two sections claiming one id',
    Effect.fnUntraced(function* () {
      const exit = yield* Effect.exit(renderWorldState([section(() => ['a']), section(() => ['b'])], {}));
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    }),
  );
  it.effect(
    'delivers changed typed inventory even when its readable text stays the same',
    Effect.fnUntraced(function* () {
      const current = ['read'];
      const inventory = worldStateSection({
        id: 'tools',
        codec: names,
        read: () => current,
        baseline: (value) => ({ type: 'text', text: 'Tools available.', deferredTools: [...value] }),
        update: (_prior, value) => ({ type: 'text', text: 'Tools available.', deferredTools: [...value] }),
      });
      const initial = yield* renderWorldState([inventory], {});
      expect(initial.kind).toBe('changed');
      if (initial.kind !== 'changed') return;
      current.push('write');
      const next = yield* renderWorldState([inventory], initial.snapshot);
      expect(next.kind).toBe('changed');
      if (next.kind !== 'changed') return;
      expect(initial.content[0]?.deferredTools).toEqual(['read']);
      expect(next.content[0]?.deferredTools).toEqual(['read', 'write']);
      expect(yield* renderWorldState([inventory], next.snapshot)).toEqual({ kind: 'unchanged', snapshot: next.snapshot });
    }),
  );
  it.effect(
    'judges a section by what the model last heard of it, not by the snapshot: heard as it stands is silent, heard otherwise is an update, heard removed or never is a baseline',
    Effect.fnUntraced(function* () {
      const told = yield* renderWorldState([section(() => ['reviewer'])], {});
      const reviewer = told.kind === 'changed' ? told.told.skills : undefined;
      if (reviewer == null) return yield* Effect.die('the first rendering told no skills');
      const heard = (digest: string | null) => new Map([['skills', digest]]);
      expect((yield* renderWorldState([section(() => ['reviewer'])], {}, heard(reviewer))).kind).toBe('unchanged');
      expect(yield* renderWorldState([section(() => ['deployer'])], { skills: ['deployer'] }, heard(reviewer))).toMatchObject({
        kind: 'changed',
        text: 'update: deployer',
      });
      expect(yield* renderWorldState([section(() => ['reviewer'])], { skills: ['reviewer'] }, heard(null))).toMatchObject({
        kind: 'changed',
        text: 'baseline: reviewer',
      });
      expect(yield* renderWorldState([section(() => withdrawn)], {}, heard(reviewer))).toMatchObject({ kind: 'changed', text: 'removed' });
    }),
  );
});
