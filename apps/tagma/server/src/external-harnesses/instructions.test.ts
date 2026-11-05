import { expect, test } from 'bun:test';
import { Schema } from 'effect';
import { instructionSetSchema, type InstructionSet } from '../graph/contract/wire/instructions.js';
import { instructionChanges } from '../graph/orientation/Instructions.js';
import { makeThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { instructionDelivery } from './instructions.js';
import { guidanceForm } from './steps/placeGuidance.js';

const set = (projectId: number, root: string, source: string): InstructionSet => ({
  projectId,
  root,
  complete: true,
  audience: 'graph',
  entries: [{ kind: 'law', source, revision: source, scope: root, text: source }],
});

const diff = (current: InstructionSet, previous?: InstructionSet) => ({ set: current, changes: instructionChanges(current, previous) });

const delivery = Schema.Record(Schema.String, instructionSetSchema);

test('an instruction update keeps other projects and replaces the selected project’s checkout', () => {
  const a = set(1, '/a', 'alpha');
  const b = set(2, '/b', 'beta');
  const first = instructionDelivery({}, [diff(a), diff(b)], 'reader');
  const moved = set(2, '/b-worktree', 'other-beta');
  const second = instructionDelivery(first.law, [diff(moved, first.law['2'])], 'reader');
  expect(second.law).toEqual({ '1': a, '2': moved });
  const repeated = instructionDelivery(second.law, [diff(a, second.law['1']), diff(moved, second.law['2'])], 'reader');
  expect(repeated.law).toEqual(second.law);
  expect(repeated.text).toBe('');
});

test('stored single-project guidance is formed into the project map once', () => {
  const prior = set(2, '/b', 'beta');
  const entry = {
    type: 'runtime-guidance',
    sources: [{ ruleId: 'prompt', state: { oriented: true, law: prior, touched: { delivered: [], heard: [] } } }],
  };
  const reader = makeThreadEntryReader({ products: [], steps: [guidanceForm] });
  const formed = reader.formed('entry', entry) as typeof entry;
  const current = formed.sources[0]!;
  expect(Schema.decodeUnknownSync(delivery)(current.state.law)).toEqual({ '2': prior });
  expect(reader.formed('entry', formed)).toBe(formed);
});
