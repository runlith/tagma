import type { PluginProcessRow, PluginRow } from '@tagma/server/plugins/contract/wire/rows';
import { expect, test } from 'vitest';
import { pluginState } from './here.js';

const plugin = (overrides: Partial<PluginRow>): PluginRow => ({
  id: 'board',
  title: 'Board',
  version: '1.0.0',
  description: null,
  format: 'tagma',
  source: { kind: 'folder', path: '/plugins/board' },
  root: '/plugins/board',
  enabled: true,
  everywhere: false,
  components: [],
  ignored: [],
  options: [],
  ...overrides,
});

const process = (state: PluginProcessRow['state']): PluginProcessRow => ({ state, tools: 2, restarts: 0 });

test('a plugin in Tagma’s format is marked by its process: broken is failing, starting is connecting, working is quiet', () => {
  expect(pluginState(plugin({ process: process('failed') }), [], null)).toBe('fails');
  expect(pluginState(plugin({ process: process('starting') }), [], null)).toBe('connecting');
  expect(pluginState(plugin({ process: process('running') }), [], null)).toBe('ok');
  expect(pluginState(plugin({ enabled: false, process: process('failed') }), [], null)).toBe('off');
});
