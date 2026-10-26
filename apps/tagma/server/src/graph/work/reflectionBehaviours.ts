import type { Behaviour } from '../contract/service/behaviours.js';
import type { TagFields } from '../contract/wire/tags/declaration.js';
import { OBSERVATION } from '../contract/wire/tags/observation.js';
import { REFLECTION } from '../contract/wire/tags/reflection.js';

const LINE = { schema: 'line' } as const;
const FACTS = ['command', 'expected', 'actual'] as const;

const isLine = (fields: TagFields, name: string): boolean => {
  const type = Object.hasOwn(fields, name) ? fields[name] : undefined;
  return typeof type === 'object' && type.type === 'schema' && type.name === LINE.schema;
};

export const observation: Behaviour = {
  id: OBSERVATION,
  slots: {},
  words: {},
  actions: [{ op: 'answer_reflection' }, { op: 'unanswer_reflection' }],
  requires: [],
  fromRoles: ({ observation: observed }) => (observed === true ? { slots: {}, words: {} } : null),
};

export const reflection: Behaviour = {
  id: REFLECTION,
  slots: { command: { kind: LINE }, expected: { kind: LINE }, actual: { kind: LINE } },
  words: {},
  actions: [],
  requires: [OBSERVATION],
  fromRoles: ({ observation: observed }, fields) =>
    observed === true && FACTS.every((name) => isLine(fields, name))
      ? { slots: { command: 'command', expected: 'expected', actual: 'actual' }, words: {} }
      : null,
};
