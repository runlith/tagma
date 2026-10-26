import { expect, test } from 'bun:test';
import type { SettingField } from '@runlith/tagma/adapter/settings';
import { normalize } from './settingValues.js';

const fields: readonly SettingField[] = [
  { id: 'name', label: 'Name', type: 'text', required: true },
  { id: 'key', label: 'Key', type: 'text', secret: true },
  { id: 'mode', label: 'Mode', type: 'choice', options: [{ id: 'a', label: 'A' }] },
  {
    id: 'models',
    label: 'Models',
    type: 'rows',
    noun: 'model',
    fields: [
      { id: 'id', label: 'Model id', type: 'text', required: true },
      { id: 'context', label: 'Context', type: 'number', required: true, min: 1 },
      { id: 'tools', label: 'Tools', type: 'set', options: [{ id: 'auto', label: 'auto' }] },
    ],
  },
];

test('declared fields are kept trimmed, empty ones dropped, and the key and strangers never reach the stored values', () => {
  expect(
    normalize(fields, { name: ' Stub ', key: 'secret', stranger: 1, mode: '', models: [{ id: 'm', context: 8, tools: [], extra: true }] }),
  ).toEqual({ values: { name: 'Stub', models: [{ id: 'm', context: 8 }] }, secrets: { key: 'secret', models: [{}] } });
});

test.each([
  [{ models: [] }, 'Name is required.'],
  [{ name: 'x', mode: 'b' }, 'Mode is not one of its options.'],
  [{ name: 'x', models: [{ id: 'm', context: 0 }] }, 'model 1: Context must be at least 1.'],
  [{ name: 'x', models: [{ id: 'm', context: 8, tools: ['none'] }] }, 'model 1: Tools holds a value that is not one of its options.'],
])('a value the schema cannot hold is refused with its reason', (given, problem) => {
  expect(normalize(fields, given)).toEqual({ problem });
});
