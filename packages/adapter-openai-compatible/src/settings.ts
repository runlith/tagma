import { ReasoningEfforts } from '@runlith/llm/schema/ids';
import type { AdapterSettings } from '@runlith/tagma/adapter/provider';
import { discover } from './discover';
import { problemWith, REASONING_FIELDS, TOOL_CHOICES } from './instance';

const REASONING_FIELD_LABELS = {
  reasoning_effort: 'reasoning_effort field',
  thinking: 'thinking switch',
  both: 'thinking switch and reasoning_effort field',
} as const satisfies Record<(typeof REASONING_FIELDS)[number], string>;

const levels = ReasoningEfforts.map((id) => ({ id, label: id }));

export const settings: AdapterSettings = {
  title: 'OpenAI-compatible providers',
  instance: 'provider',
  name: 'name',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Ollama' },
    {
      id: 'baseUrl',
      label: 'Address',
      type: 'text',
      required: true,
      placeholder: 'http://localhost:11434/v1',
      hint: 'The base URL of the API, including its /v1 prefix when it has one.',
    },
    { id: 'key', label: 'API key', type: 'text', secret: true, hint: 'Leave it empty when the server needs none.' },
    {
      id: 'reasoningField',
      label: 'Reasoning goes in the',
      type: 'choice',
      default: 'reasoning_effort',
      hint: 'Where the request carries a model’s reasoning level.',
      options: REASONING_FIELDS.map((id) => ({ id, label: REASONING_FIELD_LABELS[id] })),
    },
    {
      id: 'reasoningMapping',
      label: 'Default reasoning value mapping',
      type: 'text',
      hint: 'Optional JSON object keyed by level, for example {"low":"lite","high":"deep"}.',
    },
    {
      id: 'reasoningEcho',
      label: 'Send reasoning back',
      type: 'flag',
      hint: 'For servers that reject a history without the model’s earlier reasoning.',
    },
    {
      id: 'models',
      label: 'Models',
      type: 'rows',
      noun: 'model',
      discoverable: true,
      fields: [
        { id: 'id', label: 'Model id', type: 'text', required: true },
        { id: 'label', label: 'Label', type: 'text' },
        { id: 'context', label: 'Context window', type: 'number', required: true, min: 1, unit: 'tokens' },
        {
          id: 'output',
          label: 'Output limit',
          type: 'number',
          min: 1,
          unit: 'tokens',
          hint: 'A quarter of the window, up to 32000, when empty.',
        },
        { id: 'vision', label: 'Reads images', type: 'flag' },
        {
          id: 'toolChoice',
          label: 'Tool choice',
          type: 'set',
          hint: 'Modes beyond auto that the model accepts; auto is always allowed.',
          options: TOOL_CHOICES.filter((id) => id !== 'auto').map((id) => ({ id, label: id })),
        },
        { id: 'reasoning', label: 'Reasoning levels', type: 'set', options: levels },
        { id: 'defaultReasoning', label: 'Default level', type: 'choice', options: levels },
        {
          id: 'reasoningField',
          label: 'Reasoning request field',
          type: 'text',
          hint: 'A top-level JSON field name. Empty uses the provider default; thinking and both select the corresponding switches.',
        },
        {
          id: 'reasoningMapping',
          label: 'Reasoning value mapping',
          type: 'text',
          hint: 'Optional JSON object keyed by level. Empty uses the provider default.',
        },
      ],
    },
  ],
  validate: problemWith,
  discover,
};
