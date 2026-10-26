import { Schema } from 'effect';
import { instructionSetSchema } from '../../graph/contract/wire/instructions.js';
import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';

const isSet = Schema.is(instructionSetSchema);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const guidanceForm: ThreadFormStep = {
  name: '20261010205500_place_guidance',
  samples: {
    entry: {
      type: 'runtime-guidance',
      sources: [
        {
          ruleId: 'prompt',
          state: {
            law: {
              projectId: 1,
              root: '/project',
              complete: true,
              audience: 'graph',
              entries: [],
            },
          },
        },
      ],
    },
  },
  entry: (entry) => {
    if (entry.type !== 'runtime-guidance' || !Array.isArray(entry.sources)) return null;
    let changed = false;
    const sources = entry.sources.map((source: unknown) => {
      if (!isObject(source) || source.ruleId !== 'prompt' || !isObject(source.state) || !isSet(source.state.law)) return source;
      changed = true;
      const set = source.state.law;
      return { ...source, state: { ...source.state, law: { [String(set.projectId)]: set } } };
    });
    return changed ? { ...entry, sources } : null;
  },
};
